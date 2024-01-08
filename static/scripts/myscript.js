// グローバル変数
let sunrise_time, sunset_time;              // 日の出日の入り時刻
let morning_offset, evening_offset;         // 強制点灯のオフセット時間（分）
let morning_minutes, evening_minutes;       // 強制点灯時間（分）
let morning_start, evening_start            // 強制点灯開始時刻
let morning_end, evening_end                // 強制点灯終了時刻
let cumsum_date;                            // 積算開始日（文字列）

let sensing_interval, sensing_count;        // 何分おきに何回光センサーの状態を取得するか
let outputRelays = [0,0,0,0,0];             // 全4個のアウトプットについて出力するかしないか　0番から始まるので5個用意する

let isHumiTry, isContecTry, isLEDTry;       // 温湿度計・コンテック・育成LEDがトライか本番か
let isNightSense;                           // 夜間でも光センサー取得するか
let volt_status;                            // コンテックのバッテリーリレー状態
let graph_date;                             // デイリーグラフの日付

// バッテリー設定　この数値はサンプルで、実際は設定ファイルから読み取る
let Ah = 100;                       // アンペアアワー
let power = 12;                     // 消費電力
let LEDcnt = 150;                   // 育成LEDの数
let voltage = 24;                   // バッテリー電圧
let BTcnt = 8;                      // バッテリーの数
let charge = 1500;                  // ソーラー＋風力の発電能力

let batt_yellow = 20;               // バッテリーグラフ 黄色になるパーセント
let batt_green = 80;                // バッテリーグラフ　緑色になるパーセント

let bp;                             // バッテリーパーセント
let maxwh, pwh, pv;                 // pが付くのは現在の値
let totalwh, needwh, leastwh;

let isReady = true;                 // 運転準備　プログラム内に運転準備を落とす処理はない
let isRun = false;                  // 起動中
let isAuto = true;                  // 自動か各個か

let isLightCnt = false;             // 光センサーを取得するだけか積算するか
let isLED = false;                  // 育成LEDを光らせるか
let lastIsLED = isLED;              // 一つ前の育成LED点灯状況
let isForce = false;                // LEDを強制的にオンオフさせるか光センサーで制御するか
let mode = true                     // モード（自動／強制オン／強制オフ／手動操作中）
let lastmode = false                // 1秒前のモード　モードが変わったらログを残す

let sensing_time = "00:00";         // 次に光センサーの状態を取得する時刻
const sensing_threshold = 0.5;      // ★ LEDを付けるか消すかのしきい値（5個×回数 に対する割合）
let lightOnTime;                    // 育成LED点灯時刻　引き算をするのでdayjs形式

let tab = "main";
let lights = "○−○−○";
let temp, humi                      // 温度と湿度

let now, today, time
let logMsg="";

$(async function() {
    // 読み込み完了後に一度だけ実行する関数
    await do1st();
    setInterval(showTime, 1000);                // 1秒に1回呼び出すタイマー

    // 起動ボタンを押す
    $("#btnRun").on('click', function(){
        if (isAuto) {                           // 自動モードのみ起動可能　各個（手動）では動かない
            isRun = true;
            addMsg(time + "　起動しました");
            showRunLamp(isRun);
            getTimeMode();
            clearLightMsg();
        };
    });

    // 停止ボタンを押す
    $("#btnStop").on('click', function(){
        if (isRun) {                            // 起動中のみ停止可能
            isRun = false;                      // 起動をオフにする
            isLED = false;                      // 育成LEDをオフにする
            showRunLamp(isRun);                 // ブラウザ上の起動表示をオフにする
            lastmode = "";                      // 起動ボタン押したときに時間モードを調べるためlastmodeの値をどのモードでもない値にする
            addMsg(time + "　停止しました");
            consoleTimeLog("停止ボタン　オン");
            enpowerLED(isLED, "停止ボタンによりオフ");
        };
    });

    // 自動手動　切り替え
    $("#swAuto").on('click', async function(){
        let comment = ""
        isAuto = !isAuto;                       // 自動手動の状態を反転する
        showState();
        if (isAuto) {                           // 自動になったならば
            $("#mode").text(mode);
            addMsg(time + "　自動に切り替えました");
            comment = "自動に切り替え"
        } else {                                // 手動になったならば
            isRun = false;                      // 運転が落ちる
            isLED = false;                      // LEDを消す
            addMsg(time + "　手動に切り替えました");
            comment = "手動に切り替え"
            $("#mode").text("手動操作中");
            $("#main_msg").removeClass("main_msg_ok");
            $("#main_msg").addClass("main_msg_ng");
            $("#main_msg").text("手動操作モードです　制御盤で自動に切り替え、起動ボタンを押してください");
        }
        consoleTimeLog("自動手動切り替えスイッチ　変更");
        showLights(lights);
        await enpowerLED(isLED, comment);
        showLedLamp(isLED);
        showRunLamp(isRun);
    })

    // ランプ全点灯ボタンを押す（手動操作時のみ）
    $("#btnAllLight").mousedown(function(){
        if (! isAuto) {
            $("#imgLight").attr("src", "static/images/btnRedOn.png");
            showLights("○○○○○○○○");
            showLedLamp(true);
        }
    })

    // ランプ全点灯ボタンを離す（手動操作時のみ）
    $("#btnAllLight").mouseup(function(){
        if (! isAuto) {
            $("#imgLight").attr("src", "static/images/btnRedOff.png");
            showLights("−−−−−−−−");
            showLedLamp(false);
        }
    })

    // 育成LED強制点灯ボタンを押す（手動操作時のみ）
    $("#btnLedOn").mousedown(async function(){
        if (! isAuto) {
            $("#imgLedOn").attr("src", "static/images/btnRedOn.png");
            await enpowerLED(true, "強制点灯ボタン　押した");
        }
    })

    // 育成LED強制点灯ボタンを離す（手動操作時のみ）
    $("#btnLedOn").mouseup(async function(){
        if (! isAuto) {
            $("#imgLedOn").attr("src", "static/images/btnRedOff.png");
            await enpowerLED(false, "強制点灯ボタンから手を離した");
            showLedLamp(false);
        }
    })

    // 育成LED強制点灯ボタンを押す（手動操作時のみ）
    $("#btnLedOn").on("touchstart", async function(){
        if (! isAuto) {
            $("#imgLedOn").attr("src", "static/images/btnRedOn.png");
            await enpowerLED(true, "強制点灯ボタン　押した");
        }
    })

    // 育成LED強制点灯ボタンを離す（手動操作時のみ）
    $("#btnLedOn").on("touchend", async function(){
        if (! isAuto) {
            $("#imgLedOn").attr("src", "static/images/btnRedOff.png");
            await enpowerLED(false, "強制点灯ボタンから手を離した");
            showLedLamp(false);
        }
    })

    // 設定画面を出す
    $("#btnConfig").on("click", function(){
        openPopupWindow("config_window");
    });


    // 設定変更ボタンを押す
    $(".config_confirm").on("click", function(){
        setConfig();
        closePopupWindow();
        clearLightMsg(true);
    });

    // 設定画面を閉じる
    $(".config_bg").on("click", function(){
        closePopupWindow();
    });

    // 工場設定画面を出す
    $("#btnAdmin").on("click", function(){
        openPopupWindow("admin_window");
    });

    // 時計画面を出す
    $("#btnClock").on("click", function(){
        const now = dayjs();
        $("#year").val(now.year());
        $("#month").val(now.month()+1);                 // 月は0～11で返されるので+1する
        $("#day").val(now.date());
        $("#hour").val(now.hour());
        $("#minute").val(now.minute());
        openPopupWindow("clock_window");
    });

    // 時計設定ボタンを押す
    $("#setClock").on("click", function(){
        const year = $("#year").val();
        const month = $("#month").val();                // dayjsを使っているわけではないので-1しない
        const day = $("#day").val();
        const hour = $("#hour").val();
        const minute = $("#minute").val();
        const set_time = dayjs(`${year}-${month}-${day} ${hour}:${minute}:00`).format("MMDDHHmmYYYY");
        setClock(set_time);
        closePopupWindow();
    });

    // DB画面を出す
    $("#btnDB").on("click", function(){
        openPopupWindow("db_window");
    });

    // DB削除ボタンを押す
    $("#del_db").on("click", function(){
        const del_year = $("#del_year").val();                                      // 年
        const del_month = ("00" + $("#del_month").val()).slice(-2);                 // 月　先頭に0を付けたうえで右2文字を取得する
        const del_day = ("00" + $("#del_day").val()).slice(-2);                     // 日　つまり0埋めの数値となる
        const del_strdate = `${del_year}/${del_month}/${del_day}`;                  // 年/月/日　空白など無効な状態になってるかも
        const del_date = dayjs(del_strdate).format("YYYY/MM/DD");                   // それをdayjsにし、再度年/月/日にする
        const isValid = (del_strdate==del_date);                                    // del_strdate と del_date は等しいかどうか
        if (isValid) {
            msg = del_strdate + " 以前のデータを削除しました";
            delDB(del_strdate);
            closePopupWindow();
        } else {
            msg = del_strdate + " は有効な日付ではありません";
        };
        $("#del_result").text(msg);
    });


    // CSV保存ボタンを押す
    $("#btnCsv").on("click", function(){
        saveCSV();
        closePopupWindow();
    });


    // トライボタン切り替え（ボタンの色を反転するのみ）　実際の設定はOKボタンを押したときに変わる
    $(".btnTry").on('click', function(){
        const btnid = $(this).attr("id");
        const bool = ! $("#" + btnid).hasClass("btnTryOn");      // btnTryOnクラスを持つかどうか
            showTryBtn("#"+btnid, bool);
    })


    // 出力選択ボタンを押す
    $(".btnOutput").on('click', function(){
        const id = $(this).attr("id");              // ボタンID
        const num = id.slice(-1);                   // IDの末尾1文字
        let bool = outputRelays[num];               // そのボタンの状態
        bool = ! bool;                              // 設定反転する
        outputRelays[num] = bool;                   // 反転した結果を変数に代入する
        showOutputLamp("#" + id, bool);             // 反転した結果でランプを点灯消灯させる
    });

    // グラフの日付変更ボタンを押す
    $("#dayNimus").on('click', function(){
        drawDailyGraph(-1);
    });

    $("#dayPlus").on('click', function(){
        drawDailyGraph(1);
    });

    $("#dayToday").on('click', function(){
        drawDailyGraph(0);
    });

});


//////////////////////////////////////////////////////////////////////
// 最初に1回だけ実行する関数
//////////////////////////////////////////////////////////////////////
async function do1st() {
    // インプットボックスにjQuery keypadを設定する
    const kbOpt = {showAnim: "slideDown", showOptions: null, duration: "fast", showOn:"button"};    // 数値キーパッドのオプション
    const ids = ["lat", "lon", "elev", "morning_offset", "evening_offset", "morning_minutes", "evening_minutes",
                "sensing_interval", "sensing_count", "year", "month", "day", "hour", "minute", "batt_yellow", "batt_green",
                "cumsum_year", "cumsum_month", "cumsum_day", "del_year", "del_month", "del_day"];    // キーパッドを設定するid
    $.each(ids, function(i, id){
        $("#" + id).keypad(kbOpt);
    });
    getNow();
    clearMsg();
    addMsg(time+"　開始")
    showReadyLamp(isReady);                 // Ready（運転準備）ランプ
    showRunLamp(isRun);                     // 起動ランプ
    await getEphem();                       // 暦を取得する
    await getConfig();                      // 設定を取得する
    calcTime();                             // 時間を計算する
    await enpowerLED(false, "アプリ起動");    // LEDをオフにする　最初はオフに決まっているが、ログにも残すため必要
    clearLightMsg();
    await getHumi(isHumiTry);
    await showDairyGraph();
    await getContec(isContecTry, isLightCnt);
    showLights(lights);
    await getSummaryTable();
    graph_date = today;
    $("#graph_date").text(graph_date);
    // await showSummaryGraph();
}


// 今日の日付を取得する　グローバル変数に格納するだけ
function getNow() {
    now = dayjs();
    today = now.format("YYYY/MM/DD");
    time = now.format("HH:mm:ss");
};


//////////////////////////////////////////////////////////////////////
// 時計　兼　アラーム
//////////////////////////////////////////////////////////////////////
async function showTime() {
    getNow();
    $("#time").html(today + " " + time);

    const h = now.hour();
    const m = now.minute();
    const s = now.second();

    // 毎秒実施
    // 光センサーの状態を積算するかどうかの条件
    const cond = isRun && (! isForce);                                  // 条件　運転中 かつ 強制でない（光センサー取得する設定）ならば
    
    // 条件かつ定期的にコンテック（光センサー＋バッテリー）を取得する
    if (time >= sensing_time) {                                         // センサーを取得する時刻になったら
        sensing_time = dayjs().add(sensing_interval, "minutes").format("HH:mm:30");     // 次に光センサーを取得する時刻
        if (cond) {                                                     // 条件を満たしていたら
            isLightCnt = true;                                          // 光センサー積算する
        } else {                                                        // 条件を満たしていなかったら
            isLightCnt = false;                                         // 積算しない
        };
    } else {                                                            // センサーを取得する時刻になっていなかったら
        isLightCnt = false;                                             // 積算しない
    };
    await getContec(isContecTry, isLightCnt);                           // 以上の条件でコンテック取得する


    // 一定時間で温湿度を更新する
    if ((m % 10)==0 && s==20) {                                          // 毎時0分・30分に
        await getHumi(isHumiTry);                                       // 温湿度取得
    }

    // 起動中のみ時刻する機能
    if (isAuto) {
        //0時0分になったらあらためて1日分の記録を残し、暦を取得する
        if (time=="00:00:00") {
            addMsg(time+"　日付が変わった")
            getEphem();
        }

        // 日の出などの時間による制御
        getTimeMode();
    }

    // 10分に1回デイリーグラフを更新する
    if ((m % 10)==0 && s==20) {                                         // 毎時0分・30分に
        await showDairyGraph();                                         // デイリーグラフ更新
        await getSummaryTable();
    }
}


//////////////////////////////////////////////////////////////////////
// トライの状態を表示する関数
function showTryBtn(btnid, bool) {
    const elm = $(btnid);
    if (btnid == "#NightSense") {
        if (bool) {
            elm.addClass("btnTryOn")
            elm.removeClass("btnTryOff");
            elm.text("測定する");
        } else {
            elm.removeClass("btnTryOn");
            elm.addClass("btnTryOff")
                elm.text("測定しない");
        };
    } else {
        if (bool) {
            elm.addClass("btnTryOn")
            elm.removeClass("btnTryOff");
            elm.text("トライ");
        } else {
            elm.removeClass("btnTryOn");
            elm.addClass("btnTryOff")
            elm.text("本番");
        };
    };
};

//////////////////////////////////////////////////////////////////////
//    ログ
//////////////////////////////////////////////////////////////////////
// メッセージを表示する
function addMsg(txt) {
    logMsg = $("#logbox").html();
    logMsg += txt;
    let msg = "";
    const rows = logMsg.split("<br>")                           // メッセージ1行ずつのリスト
    const rowCnt = rows.length                                  // リストの行数
    const maxRowCnt = 18;                                       // 表示する最大行数
    for (i=Math.max(0, rowCnt-maxRowCnt); i<rowCnt; i++) {      // 全部で最大行になるように途中から
        msg += rows[i] + "<br>"                                 // 行メッセージを追加
    }
    $("#logbox").html(msg);                                     // それをあらためて表示する
}

// メッセージを全削除する
function clearMsg() {
    $("#logbox").html("");
}

// センサーログを表示する
function addLightLog(txt) {
    logMsg = $("#lightlog").html();
    logMsg += txt + "<br>";
    $("#lightlog").html(logMsg);
}

// 光センサーログを削除する
function clearLightMsg(isReset = false) {                               // 設定変更したときはisReset = trueとなる
    var html = "";
    if (isRun) {                                                        // 起動中ならば
        if (isForce) {                                                  // 強制中ならば
            if (isLED) {                                                // 強制点灯中ならば
                html = "強制点灯中です";
            } else {                                                    // 強制消灯中ならば
                html = "強制消灯中です";
            };
        } else {                                                        // 光センサー制御中ならば
            if (isReset) {                                              // 光センサー積算がリセットされたら
                html += "光センサー積算　リセットしました<br>"
            }
            html += `光センサー　○：曇り　−：晴れ<br>　${sensing_interval}分間隔で${sensing_count}回測定し、次の点灯消灯を判断します<br><br>`;
        };
    } else {                                                            // 起動中でなければ
        html = "停止中です";
    }
    $("#lightlog").html(html);
}


// サマリーテーブル
async function getSummaryTable() {
    consoleTimeLog("サマリーテーブル　作成開始");
    await $.ajax("/getSummaryTable", {
        type: "POST",
        data: {},
    }).done(function(data) {
        const dict = JSON.parse(data);
        const html = dict["html"];
        $("#dailylog").html(html);
        $("#dailylog_main").html(html);
        consoleTimeLog("サマリーテーブル　取得成功");
    }).fail(function() {
        consoleTimeLog("サマリーテーブル　取得失敗");
    });
};

// サマリーグラフ
async function showSummaryGraph() {
    consoleTimeLog("サマリーグラフ　開始");
    await $.ajax("/showSummaryGraph", {
        type: "POST",
        data: {},
    }).done(function(data) {
        const dict = JSON.parse(data);
        const light_b64 = dict["light_b64"];
        const temp_b64 = dict["temp_b64"];
        $("#graph_light").attr("src", light_b64);
        $("#graph_temp").attr("src", temp_b64);
        consoleTimeLog("サマリーグラフ　取得成功");
    }).fail(function() {
        consoleTimeLog("サマリーグラフ　取得失敗");
    });
};

// 一日グラフ
async function showDairyGraph() {
    consoleTimeLog("デイリーグラフ　開始");
    await $.ajax("/showDairyGraph", {
        type: "POST",
        data: {},
    }).done(function(data) {
        const dict = JSON.parse(data);
        const html = dict["html"];
        const light_b64 = dict["light_b64"];
        const temp_b64 = dict["temp_b64"];
        $("#dailylog").html(html);
        $("#dailylog_main").html(html);
        $("#daily_light").attr("src", light_b64);
        $("#daily_temp").attr("src", temp_b64);
        consoleTimeLog("デイリーグラフ　取得成功");
    }).fail(function() {
        consoleTimeLog("デイリーグラフ　取得失敗");
    });
};

async function drawDailyGraph(k) {
    // k=1 or k=-1　注目日の1日前もしくは1日後
    // k=0 今日
    if (k==0) {
        graph_date = today;
    } else {
        graph_date = graph_date.replace(/\//g, "-")                     // 日付の文字列を/区切りから-区切りに置換する
        let graph_date_js = dayjs(graph_date).add(k, "d")               // dayjs形式にしてからk日後の演算をする
        graph_date = graph_date_js.format("YYYY/MM/DD");                // あらためてdayjs形式から文字列にする
        if (graph_date > today) {                                       // 今日より後はデータがないに決まっているので
            graph_date = today;                                         // 強制的に今日に戻す
        }
    }
    $("#graph_date").text(graph_date);

    await $.ajax("/drawDairyGraph", {
        type: "POST",
        data: {"k": k, "date":graph_date},
    }).done(function(data) {
        const dict = JSON.parse(data);
        const html = dict["html"];
        const light_b64 = dict["light_b64"];
        const temp_b64 = dict["temp_b64"];
        $("#dailylog").html(html);
        $("#dailylog_main").html(html);
        if (light_b64 !="") {
            $("#daily_light").attr("src", light_b64);
        };
        if (temp_b64 != "") {
            $("#daily_temp").attr("src", temp_b64);
        };
        consoleTimeLog("デイリーグラフ　取得成功" + k);
    }).fail(function() {
        consoleTimeLog("デイリーグラフ　取得失敗" + k);
    });
};


//////////////////////////////////////////////////////////////////////
//    温湿度
//////////////////////////////////////////////////////////////////////
async function getHumi(isTry) {
    consoleTimeLog("温湿度　開始");
    await $.ajax("/getHumi", {
        type: "post",
        data: {"isTry": isTry},                 // テストか本番かのbool値をisTryとして送る
    }).done(function(data) {
        const dict = JSON.parse(data);
        if (dict["temp"] != "N/A") {            // センサー値取得できていたら
            temp = dict["temp"];
            humi = dict["humi"];
            imgB64 = dict["imgB64"]
            $("#temp").text(temp + "℃");
            $("#humi").text(humi + "％");
            $("#daily_temp").attr("src", imgB64);
            addMsg(dayjs().format("HH:mm:ss") + "　温湿度更新");
            consoleTimeLog("温湿度　成功");
        } else {                                // センサー値取得できなかったら
            consoleTimeLog("温湿度　センサー失敗");
        }
    }).fail(function() {                        // ajaxのリターン失敗したら更新しない
        consoleTimeLog("温湿度　通信失敗");
    });
}



//////////////////////////////////////////////////////////////////////
//    コンテック
//////////////////////////////////////////////////////////////////////
async function getContec(isTry, isLightCnt) {
    let msg = "";
    let comment = "";
    let isOutputTiming = false;                                         // LED制御するタイミングかどうか　初期値はfalse
    await $.ajax("/getContec", {
        type: "post",
        data: {"isTry": isTry,                                          // テストか本番か
               "isLightCnt": isLightCnt},                               // 光センサーを取得するだけか積算するか
    }).done(function(data) {
        const dict = JSON.parse(data);
        try {                                                           // センサー値取得できていたら
            // 電圧リレーの状態
            volt_status = dict["volt"];                                 // コンテックの電圧状態
            if (volt_status == 3 ) {                                    // 電圧状態3ならば
                $(".batt_blue").css("visibility","visible");            // グラフの青バーを表示
                $(".batt_green").css("visibility","visible");           // グラフの緑バーを表示
            } else if (volt_status == 2) {                              // 電圧状態2ならば
                $(".batt_blue").css("visibility","hidden");             // グラフの青バーを非表示
                $(".batt_green").css("visibility","visible");           // グラフの緑バーを表示
            } else {                                                    // いずれでもなければ　つまり電圧状態1ならば
                $(".batt_blue").css("visibility","hidden");             // グラフの青バーを非表示
                $(".batt_green").css("visibility","hidden");            // グラフの緑バーを非表示
            };                                                          // つまり、グラフの黄色バーは消えない（0の判定はない）

            // 光センサーの状態
            showLights(dict["log"]);                                    // 制御盤のランプを点灯させる
            if (isLightCnt) {                                           // 光センサー積算する設定ならば
                if (dict["light_cnt"]==1) {                             // 1回目で
                    clearLightMsg();                                    // メッセージをクリアする
                }
                const lightlog = dict["log"].slice(0,5);                // コンテック出力（光センサー＋電圧リレー計8文字）から光センサーを切り出す
                msg = time + "　#" + (dict["light_cnt"]) + "　" + lightlog;
                addLightLog(msg);

                const th = 5 * sensing_count * sensing_threshold;       // しきい値＝センサー5個*積算回数*基本しきい値
                if (dict["light_cnt"] == sensing_count) {               // 指定した回数だけセンサー値を測定したら
                    isOutputTiming = true;                              // コンテックに出力するタイミング
                    addLightLog("曇りのカウント" + dict["light_sum"] + "　　しきい値" + th);
                    
                    if (dict["light_sum"] < th) {                       // 点灯消灯判断　しきい値未満ならば
                        if (volt_status == 3) {                         // 青ならば                            
                            isLED = true;                               // 点灯させる
                            if (lastIsLED) {                                        // さっきまで点灯していたら
                                msg = "バッテリ残量十分あるので点灯継続します";
                                comment = "点灯継続";
                            } else {
                                msg = "バッテリ残量十分あるので点灯します";
                                comment = "点灯";
                            };
                        } else {
                            isLED = false;                                          // 消灯にする
                            if (lastIsLED) {                                        // さっきまで点灯していたら
                                msg = "十分明るいので消灯します";
                                comment = "消灯";
                                const lightSeconds = dayjs().diff(lightOnTime, "seconds") + 5;  // lightOnTimeから今までの時間（秒） 念のため5秒プラスしておく
                                const lightMinutes = Math.trunc(lightSeconds/60);               // 秒を分にする
                                addMsg(time + "　" + msg);
                            } else {                                                // さっきまでも消灯していたら
                                msg = "消灯を継続します";
                                comment = "消灯継続";
                                addMsg(time + "　" + msg);
                            };
                        };
                    } else {                                            // しきい値以上ならば
                        if (volt_status >= 2) {                                 // コンテックの電圧が青か緑ならば
                            isLED = true;                                       // 点灯にする
                            if (lastIsLED) {                                    // さっきまでも点灯していたら
                                msg = "点灯を継続します";
                                comment = "点灯継続";
                                addMsg(time + "　" + msg);
                            } else {                                            // さっきまで消灯していたら
                                msg = "暗いので点灯します";
                                comment = "点灯";
                                lightOnTime = dayjs();                          // 点灯開始時刻を覚えておく　文字列ではなくdayjs形式で
                                addMsg(time + "　" + msg);
                            };
                        } else {                                                // コンテックの電圧が黄色ならば
                            isLED = false;                                      // 消灯にする
                            if (lastIsLED) {                                    // さっきまで点灯していたら
                                const lightSeconds = dayjs().diff(lightOnTime, "seconds") + 5;  // lightOnTimeから今までの時間（秒） 念のため5秒プラスしておく
                                const lightMinutes = Math.trunc(lightSeconds/60);               // 秒を分にする
                                msg = "バッテリーが不足気味なので消灯します"
                                comment = "消灯";
                                //msg = "消灯します"
                                //msg += "　点灯時間 " + lightMinutes + "分";
                                addMsg(time + "　" + msg);
                            } else {                                            // さっきまでも消灯していたら
                                msg = "バッテリーが不足気味で消灯を継続します"
                                comment = "消灯継続";
                                //msg = "消灯を継続します"
                                addMsg(time + "　" + msg);
                            };
                        };
                    };
                    addLightLog(msg);
                    lastIsLED = isLED;                                  // 現在のLEDの状態を覚えておく
                };
                if (isTry) {                                            // コンテックが本番でなくトライだったら
                    comment += "（トライ）"                               // コメントに「トライ」と追加する
                };
            };
        } catch(e) {                                                    // センサー値取得できなかったら
            consoleTimeLog("コンテック　データ失敗");
            console.log(e);
        };
    }).fail(function() {                                                // ajaxのリターン失敗したら
        consoleTimeLog("コンテック　通信失敗");
    });

    if (isOutputTiming) {                                               // コンテックに出力するタイミングならば
        await enpowerLED(isLED, comment);                               // LEDを制御する            
    }
};

// 光センサーの状態を表示する関数
function showLights(txt) {
    const arr = txt.split("");
    for (let i=0; i<arr.length; i++) {
        let color="";
        if (arr[i]=="○") {
            color = "red";
        } else {
            color = "gray";
        }
        $("#lamp" + i).css("color",color);
    };
};


// 育成LEDを光らせる　もしくは消す
async function enpowerLED(bool, comment) {
    consoleTimeLog("enpowerLED 開始 " + bool);
    let img = "static/images/";
    let color = "";
    let isOn;
    if (bool) {                                         // オンにするならば
        img += "led_on.png";                            // ブラウザ上のLEDの画像をオンのものにする
        color = "red";                                  // ブラウザ上のLED状態を示すランプの色を赤にする
        isOn = 1;                                       // コンテックに送るデータは1
    } else {                                            // オフにするならば
        img += "led_off.png";                           // ブラウザ上のLEDの画像をオフのものにする
        color = "gray";                                 // ブラウザ上のLED状態を示すランプの色をグレーにする
        isOn = 0;                                       // コンテックに送るデータは0
    }
    $("#imgLed").attr("src", img);                      // ブラウザ上のLED画像
    $("#lamp_led").css("color", color);                 // ブラウザ上のLED状態ランプの色
    await $.ajax("/enpowerLED", {
        type: "post",
        data: { "isOn": isOn,
                "isTry": isLEDTry,
                "isRun": isRun,
                "comment": comment},
        }).done(function(data) {
            if (isRun) {                                // 自動運転中ならば
                const dict = JSON.parse(data);
                const imgB64 = dict["imgB64"];          // デイリーグラフの画像が返ってくるので
                $("#daily_light").attr("src", imgB64);  // それを表示する
            }
        consoleTimeLog("LED成功");
        }).fail(function() {
        consoleTimeLog("LED失敗");
    });
    consoleTimeLog("enpowerLED 完了");
}


// フラグの状態を表示する関数
function showState() {
    var strAuto = "";
    var imgSw = "";
    if (isAuto) {
        strAuto = "自動";
        imgSw = "sw_l.png";
    } else {
        strAuto = "各個";
        imgSw = "sw_r.png";
    };
    $("#stateAuto").text(strAuto);
    $("#imgAuto").attr("src", "static/images/" + imgSw );
}


// 育成LEDの状態を表示する関数
function showLedLamp(flag) {
    var color="";
    if (flag) {
        color = "red";
    } else {
        color = "gray";
    }
    $("#lamp_led").css("color",color);
}


//////////////////////////////////////////////////////////////////////
//    暦
//////////////////////////////////////////////////////////////////////
async function getEphem() {
    $("#date").text(dayjs().format("M月D日"))               // 日付
    consoleTimeLog("暦取得 開始")
    await $.ajax("/getEphem", {
        type: "POST",
    }).done(function(data) {
        const dict = JSON.parse(data);
        sunrise_time = dict["sunrise_time"];                // 日の出時刻　HH:MM形式
        sunset_time = dict["sunset_time"];                  // 日没時刻　HH:MM形式
        $("#sunrise").text(sunrise_time);                   // 日の出時刻
        $("#sunset").text(sunset_time);                     // 日没時刻
        $("#moon_phase").text(dict["moon_phase"]);          // 月相
        $("#moon_image").attr("src", dict["moon_image"]);   // 月の画像
        consoleTimeLog("暦取得 成功");
    }).fail(function() {
        consoleTimeLog("暦取得 失敗");
    });
};

function calcTime() {
    // 点灯時間を計算する　暦と設定の取得が先

    // 日の出日の入り時刻から育成LED点灯消灯の時刻を計算する
    // まずはdayjsとして計算する　そのためには日付も必要
    morning_start = dayjs(today+" "+sunrise_time).add(morning_offset, "m");
    morning_end = morning_start.add(morning_minutes, "m");
    evening_end = dayjs(today+" "+sunset_time).add(-evening_offset, "m");
    evening_start = evening_end.add(-evening_minutes, "m");
    // 次にそれを文字列にする
    morning_start = morning_start.format("HH:mm");
    morning_end = morning_end.format("HH:mm");
    evening_start = evening_start.format("HH:mm");
    evening_end = evening_end.format("HH:mm");
    // ブラウザに表示する
    $("#morning_start").text(morning_start);
    $("#evening_start").text(evening_start);
    $("#morning_end").text(morning_end);
    $("#evening_end").text(evening_end);
}


async function getTimeMode() {
    getNow();
    let cond;
    // 現在がどの時刻モードかを調べる　これは毎秒おこなう必要がある
    // ここは優先順位として大きい値から判断していく
    switch (true) {
        case time >= evening_end + ":00":   // 日の入り以降は夜モード
            mode = "夜";
            if (isNightSense) {             // 夜でも光センサー取得する設定ならば
                mode += "（センシング）";
            }
            break;
        case time >= evening_start + ":00": // 日の入り1.5H前以降は夕方モード
            mode = "夕方";
            if (isNightSense) {             // 夜でも光センサー取得する設定ならば
                mode += "（センシング）";
            }
            break;
        case time >= morning_end + ":00":   // 日の出1.5H後以降は昼モード
            mode = "昼";
            break;
        case time >= morning_start + ":00": // 日の出以降は朝モード
            mode = "朝";
            if (isNightSense) {             // 夜でも光センサー取得する設定ならば
                mode += "（センシング）";
            }
            break;
        default:                            // それ以前（0時以降）は夜モード
            mode = "夜";
            if (isNightSense) {             // 夜でも光センサー取得する設定ならば
                mode += "（センシング）";
            }
    };

    // LED制御を変更する
    if (isRun) {                            // 運転中だったら
        if (mode != lastmode) {             // 時刻モードが変わったら
            cond = true;                    // モードチェンジの条件オン
        } else {                            // さもなくば
            cond = false;                   // モードチェンジの条件オフ
        };
        lastmode = mode;                    // 現在のモードを先刻のモードとして覚えておく
    } else {                                // 運転中でなかったら
        lastmode = "";                      // 先刻のモードをどれでもないものにする（起動がかかったときモード取得するため）
        cond = false;                       // モードチェンジの条件オフ
    };
    if (cond) {                             // モードチェンジの条件を満たしてたら
        switch (mode) {
            case "夜":                       // 夜モードならば
                isForce = true;             // 強制的に
                isLED = false;              // 消灯する
                break;
            case "夕方":                      // 夕方モードならば
                if (volt_status == "黄") {       // バッテリ残量足りなかったら
                    isForce = true;             // 強制的に
                    isLED = false               // 消灯する
                } else {                        // バッテリ残量十分あれば
                    isForce = true;             // 強制的に
                    isLED = true;               // 点灯する                    
                };
                break;
            case "昼":                       // 昼モードならば
                isForce = false;                // 強制ではない
                isLED = false;                  // いったん消灯する
                break;
            case "朝":                       // 朝モードならば
                if (volt_status == "黄") {       // バッテリ残量足りなかったら
                    isForce = true;             // 強制的に
                    isLED = false;              // 消灯する
                } else {                        // バッテリ残量十分あれば
                    isForce = true;             // 強制的に
                    isLED = true;               // 点灯する                    
                };
                break;
            default:                        // それ以外（「センシング」）ならば
                isForce = false;            // 強制ではない
                isLED = false;              // 消灯する
        };
        const comment = "モード変更 " + mode;
        addMsg(time + "　" + comment);
        clearLightMsg();
        await enpowerLED(isLED, comment);            // 育成LEDを制御する
    }
    $("#mode").text(mode);
}


//////////////////////////////////////////////////////////////////////
//    データベース
//////////////////////////////////////////////////////////////////////
async function writeDB(table, values) {
    await $.ajax("/writeDB", {
        type: "POST",
        data: { "table": table,
                "values": values}
    }).done(function(data) {
        const dict = JSON.parse(data);
    }).fail(function() {
        console.log("データベース書き込み失敗");
    });
}


// 設定を取得する関数
async function getConfig() {
    consoleTimeLog("設定取得 開始")
    await $.ajax("/getConfig", {
        type: "POST",
    }).done(function(data) {
        const dict = JSON.parse(data);
        // 暦　変数にはせず、ブラウザ上に出力するのみ
        $("#place").val(dict["place"]);                         // 場所
        $("#lat").val(dict["lat"]);                             // 経度
        $("#lon").val(dict["lon"]);                             // 緯度
        $("#elev").val(dict["elev"]);                           // 標高

        // 朝と夕方の強制点灯の設定
        morning_offset = Number(dict["morning_offset"]);        // 日の出の何分後に始まる
        evening_offset = Number(dict["evening_offset"]);        // 日の入りの何分前に終わる
        morning_minutes = Number(dict["morning_minutes"]);      // 朝の強制点灯時間
        evening_minutes = Number(dict["evening_minutes"]);      // 夕方の強制点灯時間
        $("#morning_offset").val(morning_offset);
        $("#evening_offset").val(evening_offset);
        $("#morning_minutes").val(morning_minutes);
        $("#evening_minutes").val(evening_minutes);
        
        // 光センサー取得設定
        sensing_interval = Number(dict["sensing_interval"]);    // 光センサー取得間隔
        sensing_count = Number(dict["sensing_count"]);          // 光センサー取得回数
        $("#sensing_interval").val(sensing_interval);
        $("#sensing_count").val(sensing_count);

        // コンテックのボード出力設定
        for (i=1; i<=4; i++) {
            outputRelays[i] = str2Bool(dict["output" + i]);     // 文字列の0/1を真偽値にする
            showOutputLamp("#output" + i, outputRelays[i]);     // 状態を画面に表示する
        }

        // バッテリー設定
        batt_yellow = dict["batt_yellow"];
        batt_green = dict["batt_green"];
        $(".batt_yellow").css("width", batt_yellow+"%");
        $(".batt_green").css("width", (batt_green-batt_yellow)+"%");
        $(".batt_blue").css("width", (100-batt_green)+"%");
        $("#batt_yellow").val(batt_yellow);
        $("#batt_green").val(batt_green);

        // トライボタン
        isHumiTry = str2Bool(dict["isHumiTry"]);
        isContecTry = str2Bool(dict["isContecTry"]);
        isLEDTry = str2Bool(dict["isLEDTry"]);
        isNightSense = str2Bool(dict["isNightSense"]);
        showTryBtn("#HumiTry", isHumiTry);
        showTryBtn("#ContecTry", isContecTry);
        showTryBtn("#LEDTry", isLEDTry);
        showTryBtn("#NightSense", isNightSense);

        cumsum_date = dict["cumsum_date"];                              // 累計の始点
        const js_from = dayjs(cumsum_date);
        const cumsum_year = js_from.year();
        const cumsum_month = js_from.month()+1;                         // 月は0～11で返されるので+1する
        const cumsum_day = js_from.date();
        $("#cumsum_year").val(cumsum_year);
        $("#cumsum_month").val(cumsum_month);
        $("#cumsum_day").val(cumsum_day);
        sensing_time = dayjs().add(1, "minutes").format("HH:mm:30");    // 次に光センサーを取得する時刻
        
        // ブラウザ起動時に
        
        
        consoleTimeLog("設定取得 成功");
    }).fail(function() {
        consoleTimeLog("設定取得 失敗");
    });
};

// 設定を変更する関数
async function setConfig() {
    consoleTimeLog("設定変更 開始")
    let dict = {};                                                              // 空の辞書
    // ブラウザ上に表示されている値をまとめて辞書に登録する
    const ids = [   "place", "lat", "lon", "elev",
                    "morning_offset", "evening_offset", "morning_minutes", "evening_minutes",
                    "sensing_interval", "sensing_count",
                    "batt_yellow", "batt_green"];
    $.each(ids, function(i, id){
        dict[id] = $("#" + id).val();
    });

    // 累計開始日は日付の形にして登録する
    const cumsum_year = $("#cumsum_year").val();                                // 年
    const cumsum_month = ("0" + $("#cumsum_month").val()).slice(-2);            // 月　先頭に0を付けたうえで右2文字を取得する
    const cumsum_day = ("0" + $("#cumsum_day").val()).slice(-2);                // 日　つまり0埋めの数値となる
    const cumsum_date = `${cumsum_year}/${cumsum_month}/${cumsum_day}`;
    dict["cumsum_date"] = cumsum_date;

    // アウトプット設定は別途登録する  true/falseに0を足すことで1/0にする
    for (i=1; i<=4; i++) {
        dict["output" + i] = outputRelays[i] + 0;
    }

    // トライか本番かの設定は別途登録する  true/falseに0を足すことで1/0にする
    isHumiTry = $("#HumiTry").hasClass("btnTryOn");
    isContecTry = $("#ContecTry").hasClass("btnTryOn");
    isLEDTry = $("#LEDTry").hasClass("btnTryOn");
    isNightSense = $("#NightSense").hasClass("btnTryOn");
    dict["isHumiTry"] = isHumiTry + 0;
    dict["isContecTry"] = isContecTry + 0;
    dict["isLEDTry"] = isLEDTry + 0;
    dict["isNightSense"] = isNightSense + 0;

    // 設定ファイルに書き込む
    await $.ajax("/setConfig", {
        type: "POST",
        data: dict,
    }).done(function(data) {
        consoleTimeLog("設定変更 成功");
    }).fail(function() {
        consoleTimeLog("設定変更 失敗");
    });

    if (isNightSense) {                     // 夜でもセンシングする設定ならば1分後に測定する
        sensing_time = sensing_time = dayjs().add(1, "minutes").format("HH:mm:30");
    }

    morning_offset = dict["morning_offset"];
    evening_offset = dict["evening_offset"];
    morning_minutes = dict["morning_minutes"];
    evening_minutes = dict["evening_minutes"];
    sensing_interval = dict["sensing_interval"];
    sensing_count = dict["sensing_count"];
    batt_yellow = dict["batt_yellow"];
    batt_green = dict["batt_green"];
    calcTime();                                     // 変更した設定に伴い再計算する
    lastmode = "";                                  // 先刻のモードをどれでもないものにする（1秒後に正しい状態を表示する）
    //await showSummaryGraph();                     // 変更した設定に伴い再描画する
    await getSummaryTable();

};


// データベース削除
async function delDB(date) {
    consoleTimeLog("データベース削除 開始");
    await $.ajax("/delDB", {
        type: "POST",
        data: {"date": date},
    }).done(function(data) {
        consoleTimeLog("データベース削除 成功");
    }).fail(function(e) {
        consoleTimeLog("データベース削除 失敗");
        consoleTimeLog(e);
    });
    await showSummaryGraph();                       // 変更されたDBに基づきサマリーグラフ作成
    await getSummaryTable();                        // 変更されたDBに基づきサマリーテーブル作成
};

// データベースCSV出力
async function saveCSV() {
    await $.ajax("/saveCSV", {
        type: "POST",
        data: {"cumsum_date": cumsum_date},
    }).done(function(data) {
        consoleTimeLog("CSV保存 成功");
    }).fail(function(e) {
        consoleTimeLog("CSV保存 失敗");
        console.log(e);
    });
};


// PythonでOSの時刻を変更する関数
async function setClock(set_time) {
    // 時計変更する前に、変更前の日時でLEDをオフにする
    // そうしないとLEDがオンの場合その日は23:59までずっとオンだったことになってしまう
    consoleTimeLog("時計変更 開始");
    if (isLED) {                                        // LED点灯状態ならば
        await enpowerLED(false, "時計変更によりオフ")      // LED消灯する
    }
    lastmode = "";                                      // 時間帯モードをリセットする
    
    // 時計変更する
    await $.ajax("/setClock", {
        type: "POST",
        data: {"set_time": set_time},
    }).done(function(data) {
        consoleTimeLog("時計変更 成功");
    }).fail(function(e) {
        consoleTimeLog("時計変更 失敗");
        console.log(e);
    });

    await showDairyGraph();                             // デイリーグラフ更新する

};


// 起動ランプ
function showRunLamp(bool) {
    if (bool) {
        $("#btnRun").attr("src", "static/images/btnOrangeOn.png");
        $("#main_msg").removeClass("main_msg_ng");
        $("#main_msg").addClass("main_msg_ok");
        $("#main_msg").text("起動中です");
        $("#clock_msg").text("　　時刻設定は起動オフ状態でおこなってください");
        $("#setClock").hide();
        consoleTimeLog("起動ボタン　オン");
    } else {
        $("#btnRun").attr("src", "static/images/btnOrangeOff.png");
        $("#main_msg").removeClass("main_msg_ok");
        $("#main_msg").addClass("main_msg_ng");
        $("#main_msg").text("停止中です　制御盤で起動ボタンを押してください");
        $("#clock_msg").text("");
        $("#setClock").show();
        consoleTimeLog("起動ボタン　オフ");
    }
}

// 運転準備（Ready）ランプ
function showReadyLamp(bool) {
    if (bool) {
        $("#lampReady").attr("src", "static/images/btnGreenOn.png");
        consoleTimeLog("運転準備　オン");
    } else {
        $("#lampReady").attr("src", "static/images/btnGreenOff.png");
        consoleTimeLog("運転準備　オン");
    }
}

// アウトプットリレーランプ
function showOutputLamp(id, bool) {
    if (bool) {
        $(id).addClass("outputOn");
        $(id).removeClass("outputOff");
        } else {
        $(id).removeClass("outputOn");
        $(id).addClass("outputOff");
    };
};


// 設定のポップアップを開く関数
async function openPopupWindow(window) {
    await getConfig();
    $(".config_bg").css("visibility", "visible");
    $(".config_window").css("visibility", "hidden");
    $(".admin_window").css("visibility", "hidden");
    $(".clock_window").css("visibility", "hidden");
    $(".db_window").css("visibility", "hidden");
    $("." + window).css("visibility", "visible");
}

// 設定のポップアップを閉じる関数
function closePopupWindow() {
    $(".config_bg").css("visibility", "hidden");
    $(".config_window").css("visibility", "hidden");
    $(".admin_window").css("visibility", "hidden");
    $(".clock_window").css("visibility", "hidden");
    $(".db_window").css("visibility", "hidden");
    $("#del_result").text("");
}


// 文字列のtrue/falseを真偽値に変換する関数
function str2Bool(str){
    if (typeof str != "string") { 
        return Boolean(str); 
    }
    try {
        let obj = JSON.parse(str.toLowerCase());
        return obj == true;
    } catch(e) {
        return str != "";
    }
}

// sleep関数 asyncの中で await sleep(n)と呼ぶ
function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}


//
function consoleTimeLog(text) {
    console.log(dayjs().format("HH:mm:ss.SSS") + "　" + text);
}
