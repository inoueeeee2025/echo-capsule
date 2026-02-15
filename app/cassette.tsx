import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
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

const WHEEL_SPIN_MS = 4000;

export default function CassetteScreen() {
  const router = useRouter();
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: WHEEL_SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotate]);

  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <ImageBackground
      source={require("../assets/images/cassette_background.png")}
      resizeMode="cover"
      style={styles.background}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.cassetteArea, styles.cassetteAreaLandscape]}>
          <Animated.Image
            source={require("../assets/images/leftwheel.png")}
            resizeMode="contain"
            style={[styles.leftWheel, styles.leftWheelLandscape, { transform: [{ rotate: spin }] }]}
          />
          <Animated.Image
            source={require("../assets/images/rightwheel.png")}
            resizeMode="contain"
            style={[
              styles.rightWheel,
              styles.rightWheelLandscape,
              { transform: [{ rotate: spin }] },
            ]}
          />
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
  leftWheel: {
    position: "absolute",
    left: "12%",
    top: "19%",
    width: "3%",
    height: "3%",
    zIndex: 2,
  },
  leftWheelLandscape: {
    left: 100,
    top: 85,
    width: 250,
    height: 250,
  },
  rightWheel: {
    position: "absolute",
    right: "12%",
    top: "19%",
    width: "34%",
    height: "34%",
    zIndex: 2,
  },
  rightWheelLandscape: {
    right: 70,
    top: 60,
    width: 300,
    height: 300,
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




});
