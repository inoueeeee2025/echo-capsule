import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Recordを起点にする（タブ無し） */}
        <Stack.Screen name="record/rec" />
        <Stack.Screen
          name="cassette"
          options={{ orientation: "landscape", animation: "none" }}
        />

        {/* もしモーダルを使うなら残す */}
        <Stack.Screen name="modal" options={{ presentation: "modal" }} />
      </Stack>

      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
