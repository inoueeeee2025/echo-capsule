import React from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";

const TOOLBAR_WIDTH = 204;
const TOOLBAR_HEIGHT = 44;
const PILL_WIDTH = TOOLBAR_WIDTH / 2;
const REC_LABEL_LEFT = 6.5;
const ARCHIVE_LABEL_LEFT = PILL_WIDTH - 8;

export default function RecordToolbar() {
  return (
    <View style={styles.toolbarWrapper}>
      <View style={styles.toolbarPng}>
        <Image
          source={require("../assets/images/Switch_base.png")}
          style={styles.toolbarBase}
          resizeMode="contain"
        />
        <Animated.Image
          source={require("../assets/images/Segmented_active.png")}
          style={[styles.toolbarPill, { transform: [{ translateX: 0 }] }]}
          resizeMode="contain"
        />

        <Pressable style={styles.hitLeft} onPress={() => {}} />
        <Pressable style={styles.hitRight} disabled />

        <View style={styles.toolbarTextRow} pointerEvents="none">
          <Text style={[styles.toolbarText, styles.toolbarTextRec, styles.toolbarTextOn]}>
            rec
          </Text>
          <Text style={[styles.toolbarText, styles.toolbarTextArchive]}>archive</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbarWrapper: {
    width: "100%",
    alignItems: "center",
    marginTop: 30,
  },
  toolbarPng: {
    width: TOOLBAR_WIDTH,
    height: TOOLBAR_HEIGHT,
    position: "relative",
    transform: [{ scale: 0.94 }],
  },
  toolbarBase: {
    position: "absolute",
    width: TOOLBAR_WIDTH,
    height: TOOLBAR_HEIGHT,
    left: 0,
    top: 0,
    opacity: 0.55,
    tintColor: "rgb(150,140,155)",
    shadowColor: "#8f7c8f",
    shadowOpacity: 0.26,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  toolbarPill: {
    position: "absolute",
    width: PILL_WIDTH - 1,
    height: TOOLBAR_HEIGHT - 3,
    left: 6,
    top: 2,
    opacity: 0.82,
    tintColor: "rgba(255, 255, 255, 0.89)",
    shadowColor: "#ffffff",
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  hitLeft: {
    position: "absolute",
    left: 0,
    top: 0,
    width: PILL_WIDTH,
    height: TOOLBAR_HEIGHT,
  },
  hitRight: {
    position: "absolute",
    left: PILL_WIDTH,
    top: 0,
    width: PILL_WIDTH,
    height: TOOLBAR_HEIGHT,
  },
  toolbarTextRow: {
    position: "absolute",
    left: 0,
    top: 0,
    width: TOOLBAR_WIDTH,
    height: TOOLBAR_HEIGHT,
    flexDirection: "row",
  },
  toolbarText: {
    position: "absolute",
    top: 0,
    width: PILL_WIDTH,
    textAlign: "center",
    lineHeight: TOOLBAR_HEIGHT,
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.75)",
  },
  toolbarTextRec: { left: REC_LABEL_LEFT },
  toolbarTextArchive: { left: ARCHIVE_LABEL_LEFT },
  toolbarTextOn: { color: "rgba(255, 255, 255, 0.75)" },
});
