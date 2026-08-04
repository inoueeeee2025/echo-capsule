// Echo Capsule — カセット型コントローラ ファームウェア
//
// 3つのボタン（STOP / PLAY / REC）の押下状態を WebSocket でアプリへ送出する。
// スピーカー・マイクは非搭載。録音と再生は挿入したスマホ側が担当する。
//
// 仕様と検証結果は docs/HARDWARE.md を参照。

#include <WiFi.h>
#include <RPAsyncTCP.h>
#include <ESPAsyncWebServer.h>

#define STASSID "_echocapsule_dev"
#define STAPSK "braincorp"

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ===== Pins =====
constexpr int PIN_STOP = 14;
constexpr int PIN_PLAY = 10;
constexpr int PIN_REC = 15;

// RGB LED pins
constexpr int LED_GREEN = 21;
constexpr int LED_BLUE  = 20;
constexpr int LED_RED   = 18;

// ===== 送出の間隔 =====
constexpr uint32_t SEND_INTERVAL_MS    = 50;
constexpr uint32_t CLEANUP_INTERVAL_MS = 1000;
constexpr uint32_t PING_INTERVAL_MS    = 3000;
constexpr uint32_t BLINK_INTERVAL_MS   = 500;

// LED Blink
uint32_t lastBlinkMs = 0;
bool blinkState = false;

// 録音中フラグ（毎ループ更新する）
bool recording = false;

// 未送出の状態変化があるか。
// 送信できたときだけ false に戻す。レート制限で送れなかった変化を取りこぼさないため。
bool pendingSend = false;

uint32_t lastSendMs    = 0;
uint32_t lastCleanupMs = 0;
uint32_t lastPingMs    = 0;

// デバウンス構造体
struct DebouncedBtn {
  int pin;
  int stable;
  int lastRead;
  uint32_t lastFlip;
};

DebouncedBtn bStop{ PIN_STOP, HIGH, HIGH, 0 };
DebouncedBtn bPlay{ PIN_PLAY, HIGH, HIGH, 0 };
DebouncedBtn bRec{ PIN_REC,  HIGH, HIGH, 0 };

// 3ボタンの確定状態を JSON にする
void buildStateJson(char *out, size_t size) {
  snprintf(out, size,
    "{\"stop\":%s,\"play\":%s,\"rec\":%s}",
    (bStop.stable == LOW) ? "true" : "false",
    (bPlay.stable == LOW) ? "true" : "false",
    (bRec.stable  == LOW) ? "true" : "false");
}

void onWsEvent(AsyncWebSocket *server,
               AsyncWebSocketClient *client,
               AwsEventType type,
               void *arg,
               uint8_t *data,
               size_t len) {

  if (type == WS_EVT_CONNECT) {
    Serial.printf("[WS] connected id=%u (clients=%u)\n",
                  client->id(), ws.count());
    // 接続時は必ず全 false を送る（アプリ側のエッジ検出の初期値と揃える）
    client->text("{\"stop\":false,\"play\":false,\"rec\":false}");
  }
  else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("[WS] disconnected (clients=%u)\n", ws.count());
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);

  // LED 初期化
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE,  OUTPUT);
  pinMode(LED_RED,   OUTPUT);

  digitalWrite(LED_GREEN, LOW);
  digitalWrite(LED_BLUE,  LOW);
  digitalWrite(LED_RED,   LOW);

  // ボタン
  pinMode(PIN_STOP, INPUT_PULLUP);
  pinMode(PIN_PLAY, INPUT_PULLUP);
  pinMode(PIN_REC,  INPUT_PULLUP);

  // WiFi AP
  WiFi.mode(WIFI_AP);
  IPAddress ip(192, 168, 46, 1);
  IPAddress subnet(255, 255, 255, 0);
  WiFi.softAPConfig(ip, ip, subnet);
  WiFi.softAP(STASSID, STAPSK);

  Serial.print("[WiFi] AP IP=");
  Serial.println(WiFi.softAPIP());

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  server.on("/", HTTP_GET, [](AsyncWebServerRequest *r){
    r->send(200, "text/plain", "ESPAsyncWebServer OK");
  });
  server.begin();
}

// デバウンス。状態が確定したときだけ true を返す。
bool updateDebounce(DebouncedBtn &b, uint32_t now, uint32_t ms = 25) {
  int raw = digitalRead(b.pin);
  if (raw != b.lastRead) {
    b.lastRead = raw;
    b.lastFlip = now;
  }
  if ((now - b.lastFlip) >= ms && b.stable != b.lastRead) {
    b.stable = b.lastRead;
    return true;
  }
  return false;
}

// LED 状態制御
//
// 優先度：
//   1. 録音中（赤）
//   2. WebSocket 接続あり（緑）
//   3. WiFi 端末あり（青点灯）
//   4. その他（青点滅）
//
// 以前は loop() 内で return しながら分岐していたため、
// この下に書いた処理が実行されない事故が起きやすかった。関数に切り出してある。
void updateLed(uint32_t now) {
  if (recording) {
    digitalWrite(LED_RED,   HIGH);
    digitalWrite(LED_GREEN, LOW);
    digitalWrite(LED_BLUE,  LOW);
    return;
  }

  if (ws.count() > 0) {
    digitalWrite(LED_GREEN, HIGH);
    digitalWrite(LED_RED,   LOW);
    digitalWrite(LED_BLUE,  LOW);
    return;
  }

  if (WiFi.softAPgetStationNum() > 0) {
    digitalWrite(LED_BLUE,  HIGH);
    digitalWrite(LED_GREEN, LOW);
    digitalWrite(LED_RED,   LOW);
    return;
  }

  if (now - lastBlinkMs >= BLINK_INTERVAL_MS) {
    lastBlinkMs = now;
    blinkState = !blinkState;
  }
  digitalWrite(LED_BLUE,  blinkState ? HIGH : LOW);
  digitalWrite(LED_GREEN, LOW);
  digitalWrite(LED_RED,   LOW);
}

void loop() {
  const uint32_t now = millis();

  // ===== 切断済みクライアントの解放 =====
  // アプリ側は上限なしで再接続を試み続けるため、これを呼ばないと
  // 解放されないクライアントが溜まり続ける。
  if (now - lastCleanupMs >= CLEANUP_INTERVAL_MS) {
    lastCleanupMs = now;
    ws.cleanupClients();
  }

  // ===== キープアライブ =====
  // スマホが黙って AP から離れた場合、FIN が飛ばないので
  // ping を打たないと ws.count() が減らず、緑 LED が点いたままになる。
  if (now - lastPingMs >= PING_INTERVAL_MS) {
    lastPingMs = now;
    ws.pingAll();
  }

  // ===== ボタン処理 =====
  // 変化を検出したら pendingSend を立てるだけにして、
  // 実際に送信できるまでフラグを保持する。
  if (updateDebounce(bStop, now)) pendingSend = true;
  if (updateDebounce(bPlay, now)) pendingSend = true;
  if (updateDebounce(bRec,  now)) pendingSend = true;

  // 録音フラグは送信可否と無関係に毎ループ更新する。
  // WebSocket 未接続でも REC を押せば赤くなる。
  recording = (bRec.stable == LOW);

  // ===== 状態送出 =====
  if (pendingSend && (now - lastSendMs) >= SEND_INTERVAL_MS) {
    lastSendMs = now;
    pendingSend = false;

    if (ws.count() > 0) {
      char msg[96];
      buildStateJson(msg, sizeof(msg));
      ws.textAll(msg);
      Serial.println(msg);
    }
  }

  // ===== LED =====
  updateLed(now);
}
