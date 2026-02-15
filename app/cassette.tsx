import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const WHEEL_SPIN_MS = 6000;
const LEFT_WHEEL_SIZE = 221;
const RIGHT_WHEEL_SIZE = 288;
const DEV_AUTO_PLAY_ON_MOUNT = true;

export default function CassetteScreen() {
  const router = useRouter();
  const [isPlaying, setIsPlaying] = useState(DEV_AUTO_PLAY_ON_MOUNT);
  const rotateProgress = useRef(new Animated.Value(0)).current;
  const progressRef = useRef(0);
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Hardware integration point:
  // later, call this from hardware play/stop events.
  const handleHardwarePlaybackChange = useCallback((next: boolean) => {
    setIsPlaying(next);
  }, []);

  useEffect(() => {
    const id = rotateProgress.addListener(({ value }) => {
      progressRef.current = ((value % 1) + 1) % 1;
    });
    return () => rotateProgress.removeListener(id);
  }, [rotateProgress]);

  useEffect(() => {
    if (isPlaying) {
      if (loopRef.current) {
        loopRef.current.stop();
        loopRef.current = null;
      }
      rotateProgress.setValue(progressRef.current);
      loopRef.current = Animated.loop(
        Animated.timing(rotateProgress, {
          toValue: 1,
          duration: WHEEL_SPIN_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        { resetBeforeIteration: true },
      );
      loopRef.current.start();
      return;
    }

    if (loopRef.current) {
      loopRef.current.stop();
      loopRef.current = null;
    }
    rotateProgress.stopAnimation((value) => {
      const normalized = ((value % 1) + 1) % 1;
      progressRef.current = normalized;
      rotateProgress.setValue(normalized);
    });
  }, [isPlaying, rotateProgress, progressRef]);

  useEffect(() => {
    return () => {
      if (loopRef.current) {
        loopRef.current.stop();
        loopRef.current = null;
      }
      rotateProgress.stopAnimation();
    };
  }, [rotateProgress]);

  const spin = rotateProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const reverseSpin = rotateProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-360deg"],
  });

  return (
    <ImageBackground
      source={require("../assets/images/cassette_background.png")}
      resizeMode="cover"
      style={styles.background}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.cassetteArea, styles.cassetteAreaLandscape]}>
          <View style={[styles.leftWheelSlot, styles.leftWheelSlotLandscape]}>
            <Animated.Image
              source={require("../assets/images/leftwheel.png")}
              resizeMode="contain"
              style={[
                styles.wheelImage,
                {
                  transform: [{ rotate: reverseSpin }],
                },
              ]}
            />
          </View>
          <View style={[styles.rightWheelSlot, styles.rightWheelSlotLandscape]}>
            <Animated.Image
              source={require("../assets/images/rightwheel.png")}
              resizeMode="contain"
              style={[
                styles.wheelImage,
                {
                  transform: [{ rotate: spin }],
                },
              ]}
            />
          </View>
          <Image
            source={require("../assets/images/cassetteCover.png")}
            resizeMode="cover"
            style={styles.cassetteCover}
          />
          
        </View>
        <Image
          source={require("../assets/images/cassetteBottomBar.png")}
          resizeMode="stretch"
          style={styles.bottomBarBackground}
        />
        <View style={styles.bottomBar}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.bottomAction, styles.backAction]}
            hitSlop={8}>
            <Image
              source={require("../assets/images/backButton.png")}
              resizeMode="contain"
              style={styles.bottomButtonImage}
            />
            
          </Pressable>
          <Pressable
            onPress={() => router.replace("/record/rec")}
            style={styles.bottomAction}
            hitSlop={8}>
            <Image
              source={require("../assets/images/mobileButton.png")}
              resizeMode="contain"
              style={styles.bottomButtonImage}
            />
          </Pressable>
        </View>
        <Pressable
          onLongPress={() => handleHardwarePlaybackChange(!isPlaying)}
          delayLongPress={700}
          style={styles.devPlaybackToggleZone}
          hitSlop={16}
        />

      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#0f0f12",
  },
  safeArea: {
    flex: 1,
  },
  cassetteArea: {
    flex: 1,
    justifyContent: "center",
  },
  cassetteAreaLandscape: {
    justifyContent: "flex-start",
  },
  leftWheelSlot: {
    position: "absolute",
    left: "12%",
    top: "19%",
    width: "3%",
    height: "3%",
    zIndex: 2,
    overflow: "visible",
  },
  leftWheelSlotLandscape: {
    left: 110,
    top: 90,
    width: LEFT_WHEEL_SIZE,
    height: LEFT_WHEEL_SIZE,
  },
  rightWheelSlot: {
    position: "absolute",
    right: "12%",
    top: "19%",
    width: "34%",
    height: "34%",
    zIndex: 2,
    overflow: "visible",
  },
  rightWheelSlotLandscape: {
    right: 70,
    top: 60,
    width: RIGHT_WHEEL_SIZE,
    height: RIGHT_WHEEL_SIZE,
  },
  wheelImage: {
    width: "100%",
    height: "100%",
  },
  cassetteCover: {
    zIndex: 3,
    height:290,
    width:729,
    top:28,
    left:16,
  },



 

 
  bottomAction: {
    width: 110,
    alignItems: "center",
    
  },
  backAction: {
    marginLeft: 8,
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 24,
    paddingBottom: 8,
    zIndex: 5,
  },
  bottomBarBackground: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -2,
    width: 852,
    height: 94,
    zIndex: 4,
  },
  bottomButtonImage: {
    width: 60,
    height: 60,
  },
  devPlaybackToggleZone: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
    zIndex: 99,
  },




});
