function slack2SheetPost(jsonObj, isSlash, mode, sheet) {
  // スプレットシートに記述する
  const newRow = sheet.getLastRow() + 1;

  if (!isSlash) {
    jsonObj["link"] =
      "https://dajarerits.slack.com/archives/" +
      jsonObj["event"]["channel"] +
      "/p" +
      jsonObj["event"]["ts"].replace(".", "");
  } else {
    jsonObj["link"] = "";
  }

  const newData = [
    [
      jsonObj["event_time"], // タイムスタンプ
      jsonObj["event_id"], // イベントID
      jsonObj["event"]["user"], // ユーザーID
      jsonObj["event"]["name"], // 表示名
      jsonObj["event"]["text"], // 本文
      jsonObj["score"], // score
      jsonObj["link"],
      mode,
    ],
  ];

  sheet.getRange("A" + newRow + ":H" + newRow).setValues(newData);
}

function slackPost(channel, message) {
  // Slackの特定のチャンネルに投稿
  const token = PropertiesService.getScriptProperties().getProperty(
    "SLACK_ACCESS_TOKEN"
  );
  const slackApp = SlackApp.create(token); //SlackApp インスタンスの取得
  const options = {
    channelId: channel, // チャンネル名
    userName: "sensitive_warrior", // 投稿するbotの名前
    // 投稿するメッセージ
    message: message,
  };

  // 投稿
  slackApp.postMessage(options.channelId, options.message, {
    username: options.userName,
  });
}

function regularExpressionJudge(jsonObj, word) {
  return jsonObj["event"]["text"].match(word);
}

function slackValidation(e) {
  const jsonObj = JSON.parse(e.postData.getDataAsString());

  // observerの投稿は弾く
  if (
    !("event" in jsonObj) ||
    jsonObj["event"]["user"] === "U016VTZUE49" ||
    typeof jsonObj["event"]["user"] === "undefined"
  ) {
    return false;
  }

  // slackのchannelに参加した時のイベントを取り除く
  // この場合「<userid>~~~」という文字列がtextに入る
  const JoinWord = new RegExp("^<@" + jsonObj["event"]["user"] + ">.*");
  if (regularExpressionJudge(jsonObj, JoinWord)) {
    return false;
  }

  // slackのリアクションイベントは弾く
  // この場合「: ~~~~ :」という文字列がtextに入る
  const reactionwWord = new RegExp("^:.*:$");
  if (regularExpressionJudge(jsonObj, reactionwWord)) {
    return false;
  }

  // sensitive_bot_testチャンネル以外からのアクセスは弾く
  if (jsonObj["event"]["channel"] != "C016HJ95UUB") {
    return false;
  }

  return jsonObj;
}

function addReaction(channel, ts, emoji) {
  const token = PropertiesService.getScriptProperties().getProperty(
    "SLACK_ACCESS_TOKEN"
  );
  var payload = {
    token: token,
    channel: channel,
    timestamp: ts,
    name: emoji,
  };

  var options = {
    method: "post",
    payload: payload,
  };

  UrlFetchApp.fetch("https://slack.com/api/reactions.add", options);
}

function readingReplace(str, mode) {
  return str.replace(/\{([^{|}]+)\|([^{|}]+)\}/g, "$" + mode);
}

function iD2Name(id) {
  const token = PropertiesService.getScriptProperties().getProperty(
    "SLACK_ACCESS_TOKEN"
  );
  const slackApp = SlackApp.create(token); //SlackApp インスタンスの取得
  const userinfo = slackApp.usersInfo(id);
  return (
    userinfo["user"]["profile"]["display_name"] ||
    userinfo["user"]["profile"]["real_name"]
  );
}

function accessJudgeApi(dajare, base_url) {
  const apiUrl = "/dajare/judge/?dajare=";
  const response = UrlFetchApp.fetch(
    base_url + apiUrl + dajare.replace(/%3A[^(%3A)]+%3A+/g, "")
  ).getContentText();
  const resJson = JSON.parse(response);
  return resJson;
}

function accessEvaluateApi(dajare, base_url) {
  const apiUrl = "/dajare/eval/?dajare=";
  const response = UrlFetchApp.fetch(
    base_url + apiUrl + dajare.replace(/%3A[^(%3A)]+%3A+/g, "")
  ).getContentText();
  const resJson = JSON.parse(response);
  return Number(resJson["score"]);
}

function accessKatakanaApi(dajare, base_url) {
  const apiUrl = "/dajare/reading/?dajare=";
  const response = UrlFetchApp.fetch(
    base_url + apiUrl + dajare.replace(/%3A[^(%3A)]+%3A+/g, "")
  ).getContentText();
  const resJson = JSON.parse(response);
  return resJson["reading"];
}

function makeResponseText(jsonObj) {
  const dajareText = jsonObj["event"]["text"];
  const roundScore = Math.round(jsonObj["score"]);
  const star = "★".repeat(roundScore) + "☆".repeat(5 - roundScore);

  const message = "ダジャレ：${joke}\n名前：${name}\n順位：${rank}\n評価：${score}(${stars})\n項目：${tags}"
    .replace("${joke}", dajareText)
    .replace("${name}", jsonObj["event"]["name"])
    .replace("${rank}", jsonObj["rank"])
    .replace("${score}", Math.round(Number(jsonObj["score"]) * 1e4) / 1e4)
    .replace("${stars}", star)
    .replace("${tags}", jsonObj["sensitive_tags"].join(", "));
  return message;
}

function sensitive(jsonObj) {
  const base_url = PropertiesService.getScriptProperties().getProperty(
    "JUDGE_API_BASE_URL"
  );
  var score = -1;
  var sensitiveTags = [];
  try {
    const slicedText = jsonObj["event"]["text"].substr(
      0,
      Math.min(30, jsonObj["event"]["text"].length)
    );
    const readingReplacedText = readingReplace(slicedText, 2);
    if (readingReplacedText == "") {
      // 空文字or記号のみの時
      return;
    }
    const encodedText = encodeURIComponent(readingReplacedText);

    // ダジャレ判定APIにアクセス
    const judgeJson = accessJudgeApi(encodedText, base_url);
    const isdajare = judgeJson["is_dajare"];
    const includeSensitive = judgeJson["include_sensitive"];
    sensitiveTags = judgeJson["sensitive_tags"];
    if (!isdajare || !includeSensitive) {
      addReaction(
        jsonObj["event"]["channel"],
        jsonObj["event"]["ts"],
        !isdajare ? "thumbsdown" : "kenzen"
      );
      return;
    }

    // ダジャレ評価APIにアクセス
    score = accessEvaluateApi(encodedText, base_url);
  } catch (o_O) {
    errLogging(o_O);
    throw o_O;
  }

  // 読み方を指定してあった場合，その読み方の表記を削除({Script|スクリプト}->Script)
  jsonObj["event"]["text"] = readingReplace(jsonObj["event"]["text"], 1);

  // ユーザーの表示名を追加
  jsonObj["event"]["name"] = iD2Name(jsonObj["event"]["user"]);

  // 過去に実行されたイベントが再度出たとき，二個目は破棄する
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("index");
  const lastRow = sheet.getLastRow();
  const lastEventTime = sheet.getRange(lastRow, 1).getValue();
  const nextEventTime = jsonObj["event_time"];
  if (lastRow > 1) {
    if (parseInt(lastEventTime) >= nextEventTime) {
      return;
    }
  }

  jsonObj["rank"] =
    sheet
      .getRange("F" + 2 + ":F" + lastRow)
      .getValues()
      .filter((raw) => Number(raw) > score).length + 1;

  addReaction(
    jsonObj["event"]["channel"],
    jsonObj["event"]["ts"],
    "sensitive_ja"
  );
  const channel = jsonObj["event"]["channel"];
  jsonObj["sensitive_tags"] = sensitiveTags;
  jsonObj["score"] = score;
  slackPost(channel, makeResponseText(jsonObj));
  // スプレットシートに保存
  slack2SheetPost(jsonObj, false, channel, sheet);
}

function doPost(e) {
  const cache = makeCache();
  if (!cache.get("used")) {
    // GASを使用中にする
    cache.put("used", 1);
  } else {
    return 1;
  }
  try {
    if ("postData" in e && !("command" in e.parameter)) {
      // 通常の下ネタ
      var jsonObj = slackValidation(e);
      if (jsonObj) {
        sensitive(jsonObj);
      }
      cache.put("used", 0); // GASを未使用中にする
      return 1;
    } else if ("command" in e.parameter) {
      // スラッシュコマンド
      cache.put("used", 0); // GASを未使用中にする
      return res;
    } else {
      errLogging("undefined command(custom error)");
      cache.put("used", 0); // GASを未使用中にする
    }
  } catch (o_O) {
    cache.put("used", 0); // GASを未使用中にする
    errLogging(o_O);
    throw o_O;
  }
  return UrlFetchApp.fetch(slackUrl, options);
}

function test() {
  slackPost("#sensitive_bot_test", "テスト");
}
