import RecordToolbar from "@/components/RecordToolbar";
import { useFonts } from "expo-font";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDisplayDate(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const w = WEEKDAY[date.getDay()];
  return `${y}/${m}/${d} ${w}`;
}

export default function KaihuuTextScreen() {
  const [ydwLoaded] = useFonts({
    YDWbananaslipplus: require("../../assets/fonts/YDWbananaslipplus.otf"),
  });
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"rec" | "archive">("archive");
  const [line1Width, setLine1Width] = useState(0);
  const [line2Width, setLine2Width] = useState(0);
  const dateText = useMemo(() => formatDisplayDate(new Date()), []);
  // 文字起こし機能で生成されたテキスト（将来はAPI/保存データから差し替え）
  const transcriptLine1 = "こんにちはー";
  const transcriptLine2 = "おはようございますー";

  const ydwStyle = ydwLoaded ? styles.ydwBananaslipPlus : undefined;

  return (
    <ImageBackground
      source={require("../../assets/images/kaihuu_background.png")}
      resizeMode="cover"
      style={styles.background}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Pressable
            onPress={() => router.replace("/cassette")}
            hitSlop={8}
            style={styles.backToCassette}
          >
            <View style={styles.backToCassetteLabelWrap}>
              <Text style={styles.backToCassetteText}>カセットモードへ</Text>
              <View style={styles.backToCassetteUnderline} />
            </View>
          </Pressable>

          <RecordToolbar
            active={activeTab}
            onPressRec={() => setActiveTab("rec")}
            onPressArchive={() => setActiveTab("archive")}
          />

          <Text style={styles.dateText}>{dateText}</Text>

          <ImageBackground
            source={require("../../assets/images/textBoard.png")}
            resizeMode="stretch"
            style={styles.paperCard}
          >
            <ScrollView
              style={styles.paperScroll}
              contentContainerStyle={styles.paperScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Text
                style={[styles.lineText, ydwStyle]}
                onTextLayout={(e) => {
                  const w = e.nativeEvent.lines?.[0]?.width ?? 0;
                  if (w > 0) setLine1Width(w);
                }}
              >
                {transcriptLine1}
              </Text>
              <View style={[styles.line, { width: Math.max(1, (line1Width || 1) - 2) }]} />
              <Text
                style={[styles.lineText, styles.secondLineText, ydwStyle]}
                onTextLayout={(e) => {
                  const w = e.nativeEvent.lines?.[0]?.width ?? 0;
                  if (w > 0) setLine2Width(w);
                }}
              >
                {transcriptLine2}
              </Text>
              <View style={[styles.lineWide, { width: Math.max(1, (line2Width || 1) - 2) }]} />
            </ScrollView>
          </ImageBackground>

          <Pressable
            style={styles.audioModeLink}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/record/kaihuu");
              }
            }}
          >
            <Text style={styles.audioModeLinkText}>音声モードへ</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#c7dceb",
  },
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  backToCassette: {
    alignSelf: "flex-start",
    marginTop: 6,
    marginLeft: 2,
  },
  backToCassetteLabelWrap: {
    alignSelf: "flex-start",
  },
  backToCassetteText: {
    fontSize: 13,
    color: "#090909",
    letterSpacing: 0.2,
    top: -1,
  },
  backToCassetteUnderline: {
    height: 1,
    backgroundColor: "#090909",
    marginTop: 4,
  },
  dateText: {
    marginTop: 36,
    fontSize: 16,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
    alignSelf: "center",
  },
  paperCard: {
    marginTop: 40,
    width: 312,
    height: 449,
    flex: 1,
    maxHeight: 470,
    elevation: 3,
    paddingTop: 22,
    paddingHorizontal: 26,
    alignSelf: "center",
  },
  paperScroll: {
    flex: 1,
  },
  paperScrollContent: {
    paddingBottom: 8,
  },
  lineText: {
    fontSize: 20,
    lineHeight: 26,
    color: "#242428",
    letterSpacing: 0.3,
    alignSelf: "flex-start",
  },
  secondLineText: {
    marginTop: 20,
  },
  line: {
    marginTop: 3,
    width: 142,
    height: 2,
    backgroundColor: "#3a3a3f",
  },
  lineWide: {
    marginTop: 3,
    width: 240,
    height: 2,
    backgroundColor: "#3a3a3f",
  },
  audioModeLink: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 56,
    bottom:4,
  },
  audioModeLinkText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#767680",
    letterSpacing: 0.2,
    top: 2,
  },
  ydwBananaslipPlus: {
    fontFamily: "YDWbananaslipplus",
  },
});
