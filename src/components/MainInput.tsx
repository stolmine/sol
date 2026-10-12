import { Assets } from "assets";
import { solNative } from "lib/SolNative";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import { DevSettings, Image, Text, TouchableOpacity, View } from "react-native";
import { TextInput } from "react-native-macos";
import { useStore } from "store";
import { Widget } from "stores/ui.store";
import { BackButton } from "./BackButton";

type Props = {
	placeholder?: string;
	showBackButton?: boolean;
	style?: any;
	className?: string;
	hideIcon?: boolean;
};

export const MainInput = observer<Props>(
	({ placeholder = "Search your mac...", showBackButton, hideIcon }) => {
		const store = useStore();
		const isDarkMode = store.ui.isDarkMode;
		const inputRef = useRef<TextInput>(null);

		useEffect(() => {
			const subscription = solNative.addListener(
				"onShow",
				({ target }: { target?: string }) => {
					const length = store.ui.query.length;
					if (target != null || length === 0) {
						return;
					}
					inputRef.current?.focus();
					inputRef.current?.setSelection(0, length);
				},
			);
			return () => subscription.remove();
		}, [store]);
		const reloadApp = async () => {
			DevSettings.reload();
		};

		let leftButton = null;
		if (showBackButton) {
			leftButton = (
				<BackButton
					onPress={() => {
						store.ui.setQuery("");
						store.ui.focusWidget(Widget.SEARCH);
					}}
				/>
			);
		}

		if (!showBackButton) {
			leftButton = (
				<TouchableOpacity onPress={reloadApp}>
					<Image
						source={isDarkMode ? Assets.logoMinimal : Assets.logoMinimalWhite}
						style={{ width: 20, height: 20 }}
					/>
				</TouchableOpacity>
			);
		}

		if (hideIcon) {
			leftButton = null;
		}

		return (
			<View className="min-h-[42px] flex-row items-center gap-2 my-1 flex-1 px-2">
				{leftButton}
				<TextInput
					// nativewind's interop wrapper clobbers `ref` on RN 0.81's
					// function-component TextInput, so bypass it and style inline
					// @ts-expect-error cssInterop is consumed by nativewind's JSX runtime
					cssInterop={false}
					ref={inputRef}
					autoFocus
					enableFocusRing={false}
					value={store.ui.query}
					onChangeText={store.ui.setQuery}
					style={{
						flex: 1,
						fontSize: 18,
						color: isDarkMode ? "white" : "black",
					}}
					placeholder={placeholder}
				/>
				{__DEV__ && (
					<TouchableOpacity onPress={reloadApp}>
						<Text>Debug</Text>
					</TouchableOpacity>
				)}
			</View>
		);
	},
);
