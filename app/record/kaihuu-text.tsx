import { Redirect } from "expo-router";

export default function KaihuuTextScreen() {
  return <Redirect href={{ pathname: "/record/kaihuu", params: { mode: "text" } }} />;
}
