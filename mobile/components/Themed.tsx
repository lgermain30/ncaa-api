/**
 * Learn more about Light and Dark modes:
 * https://docs.expo.io/guides/color-schemes/
 */
import { StyleSheet, Text as DefaultText, View as DefaultView } from "react-native";

import { useColorScheme } from "./useColorScheme";

import Colors from "@/constants/Colors";
import { textScale, useSettings } from "@/lib/settings";

type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

export type TextProps = ThemeProps & DefaultText["props"];
export type ViewProps = ThemeProps & DefaultView["props"];

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark,
) {
  const theme = useColorScheme();
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}

export function Text(props: TextProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, "text");
  const scale = textScale(useSettings().textSize);
  const flat = StyleSheet.flatten(style) ?? {};
  const scaled =
    scale === 1
      ? flat
      : {
          ...flat,
          fontSize: Math.round((flat.fontSize ?? 14) * scale),
          ...(flat.lineHeight ? { lineHeight: Math.round(flat.lineHeight * scale) } : {}),
        };

  return (
    <DefaultText
      maxFontSizeMultiplier={1.2}
      style={[{ color }, scaled]}
      {...otherProps}
    />
  );
}

export function View(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const backgroundColor = useThemeColor(
    { light: lightColor, dark: darkColor },
    "background",
  );

  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />;
}
