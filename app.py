from flask import Flask, render_template, request
from myEphem import Ephem
from myContec import Contec
from myDatabase import DB
import json
import random
from time import sleep
import datetime
import configparser
import os
import sys
import subprocess as sp
import numpy as np

import RPi.GPIO as GPIO
import dht11

GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)
GPIO.cleanup()

humi_pin = 14
led_pin = 16
pilot_pin = 21
pilot_status = False
humi_sensor = dht11.DHT11(pin=humi_pin)

# グローバル変数
light_sum = 0               # 光センサーオフの累計
sensing_count = 1           # 光センサー計測リセット回数
light_cnt = 0               # 光センサー計測回数　sensing_countの回数でリセット
restart = 0                 # アプリ起動時に設備起動させるかどうか

# 日時を文字列として返す
def getTime():
    dt = datetime.datetime.now()
    return dt.strftime("%Y/%m/%d %H:%M:%S")


contec = Contec()                   # コンテックのクラス
db = DB()                           # データベースのクラス

app = Flask(__name__)

@app.route("/")
def index():
    global light_sum, light_cnt, restart
    light_sum = 0                               # 光センサーオフの累計
    light_cnt = 0                               # 光センサー計測回数　sensing_countの回数でリセット
    return render_template("index.html", restart=restart)


@app.route("/writeDB", methods = ["POST"])
def writeDB():
    if request.method == "POST":
        table = request.form["table"]
        values = int(request.form["values"])
        if table == "LED":
            db.set_LED(values)
        return json.dumps({"result": "OK"})


# DBをcsvで保存
@app.route("/saveCSV", methods = ["POST"])
def saveCSV():
    if request.method == "POST":
        cumsum_date = request.form["cumsum_date"]
        db.saveCSV(cumsum_date=cumsum_date)
        cmd = "pcmanfm /home/tab/csvデータ"          # linuxのコマンド
        sp.Popen(cmd.split())                       # 空白で区切ってリストにし、実行する
        return json.dumps({"result": "OK"})


# サマリーテーブル
@app.route("/getSummaryTable", methods=["POST"])
def getSummaryTable():
    if request.method == "POST":
        # サマリー取得
        cumsum_date = db.cumsum_date
        dict = db.get_summary_table(cumsum_date)
        html = f"<b>日々の実績　および　{cumsum_date} からの累計</b>"\
                "<table><tr><td class='center'>日付</td><td class='right'>点灯時間</td><td class='right'>時間累計</td>"\
                "<td class='right'>平均温度</td><td class='right'>温度累計</td></tr>"
        for key, item in dict.items():
            lighting_minutes = "" if np.isnan(item['lighting_minutes']) else item['lighting_minutes']
            lighting_minutes_sum = "" if np.isnan(item['lighting_minutes_sum']) else item['lighting_minutes_sum']
            mean_temp = "" if np.isnan(item['mean_temp']) else item['mean_temp']
            mean_temp_sum = "" if np.isnan(item['mean_temp_sum']) else item['mean_temp_sum']
                
            html += f"<tr><td>{key}</td>"\
                    f"<td class='right w1'>{lighting_minutes}分</td><td class='right w1'>{lighting_minutes_sum}分</td></td>"\
                    f"<td class='right w1'>{mean_temp}度</td><td class='right w1'>{mean_temp_sum}度</td></td>"
        html += "</table>"
        result = {"html": html}
        return json.dumps(result)


# サマリーグラフ
@app.route("/showSummaryGraph", methods=["POST"])
def showSummaryGraph():
    if request.method == "POST":
        # サマリー取得
        cumsum_date = db.cumsum_date
        print(cumsum_date)
        light_b64, temp_b64 = db.get_summary_graph(cumsum_date)
        result = {"light_b64":light_b64, "temp_b64":temp_b64}
        print(result)
        return json.dumps(result)


# 一日グラフ
@app.route("/showDairyGraph", methods=["POST"])
def showDairyGraph():
    if request.method == "POST":
        light_b64, temp_b64 = db.draw_dailygraph()
        result = {"light_b64":light_b64, "temp_b64":temp_b64}
        return json.dumps(result)


# 一日グラフ
@app.route("/drawDairyGraph", methods=["POST"])
def drawDairyGraph():
    if request.method == "POST":
        k = int(request.form["k"])
        date = request.form["date"]
        print(f"k is {k}")
        light_b64, temp_b64 = db.draw_dailygraph(date=date)
        result = {"light_b64":light_b64, "temp_b64":temp_b64}
        return json.dumps(result)


# 暦
@app.route("/getEphem", methods = ["POST"])
def getEphem():
    try:
        ephem = Ephem(db.ephem_config)              # 設定をもとにephemを作成する
        dict = ephem.get_data()                     # データを辞書として取得する
        db.set_ephem(dict)
    except Exception as e:
        message = str(e)
        dict = {"error": message}                   # エラーメッセージ
    return json.dumps(dict)                         # 辞書をJSONにして返す


# 温湿度計
@app.route("/getHumi", methods=["POST"])
def getHumi():
    if request.method == "POST":
        getEphem()                                      # 都度、暦を取得する
        is_try = request.form["isTry"]
        if is_try=="true":                              # トライならば
            temp = random.randint(30, 60)
            humi = random.randint(60, 90)
        else:                                           # 本番ならば
            print("本番")
            for i in range(10):                         # センサー値取得失敗するかもしれないので10回ループする
                result = humi_sensor.read()
                if result.is_valid():                   # センサー値取得できたら
                    temp = round(result.temperature, 1) # 温度 小数第一位まで
                    humi = round(result.humidity, 1)    # 湿度 小数第一位まで
                    break                               # ループから抜ける
                else:                                   # 10回ループしても駄目なら
                    temp = 10
                    humi = 10                           # ありえない値を湿度に登録する
        imgB64 = db.set_temperature(temp, humi)
        dict = {"temp": temp,
                "humi": humi,
                "imgB64": imgB64}
        return json.dumps(dict)


# 育成LED（コンテック）への出力
@app.route("/enpowerLED", methods=["POST"])
def enpowerLED():
    if request.method == "POST":
        is_On = int(request.form["isOn"])               # オンかオフか　1もしくは0
        is_try = request.form["isTry"]                  # トライか本番か
        is_Run = request.form["isRun"]                  # 自動運転中か手動操作中か
        comment = request.form["comment"]               # コメント

        # DB登録する
        getEphem()                                      # 都度、暦を取得する
        imgB64 = db.set_LED(is_On, comment)             # DBにLEDの状態を登録する　戻り値はグラフ

        # コンテックへの出力・DB登録する
        if is_try != "true":                            # トライではない、つまり本番ならば
            if contec.is_available:                     # コンテックが利用可能ならば
                contec.output(is_On)                    # オンもしくはオフの状態をコンテックに送る
            else:                                       # コンテックが利用可能でなければ
                print("contec not connected")
                # imgB64 = ""                             # グラフを返す変数に空白を代入する
        else:                                           # トライならば
            print("トライ")
            # imgB64 = ""                                 # グラフを返す変数に空白を代入する
        print("enpowerLED　完了")
        return json.dumps({"imgB64": imgB64})


# 設定DB 読み込み
@app.route("/getConfig", methods=["POST"])
def getConfig():
    global sensing_count
    if request.method == "POST":
        dict = db.get_config()                          # データベースから設定を読み込む
        # コンテックの設定はリストにして登録する
        arr = []
        for i in [1, 2, 3, 4]:
            arr.append(int(dict[f"output{i}"]))
        contec.define_output_relays(arr)
        sensing_count = int(dict["sensing_count"])
        return json.dumps(dict)


# 設定DB 書き込み
@app.route("/setConfig", methods=["POST"])
def setConfig():
    global light_cnt, light_sum
    if request.method == "POST":
        dict = {"place": request.form["place"],
                "lat": request.form["lat"],
                "lon": request.form["lon"],
                "elev": request.form["elev"],
                "morning_offset": request.form["morning_offset"],
                "evening_offset": request.form["evening_offset"],
                "morning_minutes": request.form["morning_minutes"],
                "evening_minutes": request.form["evening_minutes"],
                "sensing_interval": request.form["sensing_interval"],
                "sensing_count": request.form["sensing_count"],
                "output1": request.form["output1"],
                "output2": request.form["output2"],
                "output3": request.form["output3"],
                "output4": request.form["output4"],
                "batt_yellow": request.form["batt_yellow"],
                "batt_green": request.form["batt_green"],
                "cumsum_date": request.form["cumsum_date"],
                "isHumiTry": request.form["isHumiTry"],
                "isContecTry": request.form["isContecTry"],
                "isLEDTry": request.form["isLEDTry"],
                "isNightSense": request.form["isNightSense"],
                }
        db.set_config(dict)
        
        # コンテックリレー出力設定を変更する
        arr = []
        for i in [1,2,3,4]:
            key = f"output{i}"
            arr.append(int(request.form[key]))      # 1/0 をリストに追記していく
        contec.define_output_relays(arr)
        light_cnt = 0                               # 設定変更したら光センサー取得カウントをリセットする
        light_sum = 0
        return json.dumps({"response": "done"})


# DB削除
@app.route("/delDB", methods=["POST"])
def delDB():
    if request.method == "POST":
        del_date = request.form["date"]
        db.delete(del_date)
    return json.dumps({"result":"OK"})


# コンテック（光センサー＋バッテリー）
@app.route("/getContec", methods=["POST"])
def getContec():
    global light_cnt, light_sum, light_log, sensing_count
    if request.method == "POST":
        is_try = request.form["isTry"]
        is_light_cnt = request.form["isLightCnt"]
        if is_light_cnt == "true":
            light_cnt = light_cnt % sensing_count + 1       # カウント数で割った余り + 1
            if light_cnt == 1:                              # 1になったら つまり+1する前に割り切れたら
                light_log = ""                              # リセットする
                light_sum = 0
        inputs = []                                         # コンテックの戻り値の初期値
        if is_try=="true":                                  # トライならば
            for _ in range(8):
                inputs.append(random.choice([1, 0]))        # ランダムな値を作る
        else:                                               # 本番ならば
            if contec.is_available:                         # コンテックが利用可能ならば
                inputs = contec.input()
                # print("コンテック　本番", inputs)
            else:                                           # コンテックが利用可能でなければ
                for _ in range(8):                          # トライ時と同様、ランダムな値を作る
                    inputs.append(random.choice([1, 0]))
            pass

        # コンテックの結果を光センサーの結果と電圧リレーの結果に分ける
        lights = inputs[:5]
        volts = inputs[5:]

        log = ""
        for input in inputs:
            log += "○" if input==1 else "−"

        # 光センサーの積算
        if is_light_cnt == "true":          # 光センサーの状態を積算する設定ならば
            light_sum += sum(lights)        # 光の合計を加算する
        dict = {}
        dict["light_sum"] = light_sum
        dict["log"] = log
        dict["light_cnt"] = light_cnt

        # 電圧リレーの計算
        relay1, relay2, _ = volts           # リレー1=緑信号（低圧）　リレー2=青信号（高圧）　
        if relay2:                          # リレー2がオンならば
            dict["volt"] = 3                # 「3」
        elif relay1:                        # リレー2がオフでリレー1がオンならば
            dict["volt"] = 2                # 「2」
        else:                               # いずれでもなければ
            dict["volt"] = 1                # 「1」
        return json.dumps(dict)


# OSの時刻を設定する
@app.route("/setClock", methods=["POST"])
def setClock():
    if request.method == "POST":
        set_time = request.form["set_time"] # 設定する日時
        cmd = f"sudo date {set_time}"       # linuxのコマンド
        sp.Popen(cmd.split())               # 空白で区切ってリストにし、実行する
        return json.dumps({"response": "done"})

if __name__ == "__main__":
    # global restart
    args = sys.argv
    restart = 0 if len(args)==1 else 1      # 起動時、引数あればrestart=1 なければrestart=0
    db.write_config("restart", restart)
    
    app.run(host="0.0.0.0", port=5000, debug=True)
    # app.run(debug=True)
