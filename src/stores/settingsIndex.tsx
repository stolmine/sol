import { FileIcon } from "components/FileIcon";
import { type SettingsIndexEntry, solNative } from "lib/SolNative";
import { Linking } from "react-native";
import { systemPreferenceItems } from "./systemPreferences";
import { ItemType } from "./ui.store";

const SETTINGS_ID_PREFIX = "settings:";
const SECTION_BOOST = 0.8;
const ACCESSIBILITY_DETAIL_BOOST = 0.5;

const normalizeName = (name: string) =>
	name
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\s‐-―&-]+/g, "")
		.replace(/s$/, "");

const iconComponentFor = (iconPath: string) => (props: object) => (
	<FileIcon className="w-6 h-6" url={iconPath} {...props} />
);

export function settingsDocumentBoost(id: string) {
	if (!id.startsWith(SETTINGS_ID_PREFIX) || !id.includes("?")) {
		return 1;
	}

	return id.includes("?AX_") ? ACCESSIBILITY_DETAIL_BOOST : SECTION_BOOST;
}

export async function loadSettingsIndexItems(): Promise<Item[]> {
	if (solNative.OSVersion < 13) {
		return [];
	}

	const entries = await solNative.getSettingsIndex();
	return buildSettingsIndexItems(entries);
}

function buildSettingsIndexItems(entries: SettingsIndexEntry[]): Item[] {
	const existingPaneNames = new Set(
		systemPreferenceItems.map((item) => normalizeName(item.name)),
	);
	const seenIds = new Set<string>();
	const seenTitles = new Set<string>();
	const iconComponents = new Map<string, Item["IconComponent"]>();
	const items: Item[] = [];

	for (const entry of entries) {
		let IconComponent = iconComponents.get(entry.iconPath);
		if (IconComponent == null) {
			IconComponent = iconComponentFor(entry.iconPath);
			iconComponents.set(entry.iconPath, IconComponent);
		}

		const paneName = normalizeName(entry.paneName);
		const callback = () => {
			Linking.openURL(entry.url);
		};

		if (entry.anchor == null) {
			if (existingPaneNames.has(paneName)) {
				continue;
			}

			items.push({
				id: `${SETTINGS_ID_PREFIX}${entry.paneId}`,
				name: entry.paneName,
				IconComponent,
				type: ItemType.PREFERENCE_PANE,
				callback,
			});
			continue;
		}

		const title = normalizeName(entry.title);
		const titleKey = `${entry.paneId}\n${title}`;
		if (title === paneName || seenTitles.has(titleKey)) {
			continue;
		}
		seenTitles.add(titleKey);

		const baseId = `${SETTINGS_ID_PREFIX}${entry.paneId}?${entry.anchor}`;
		let id = baseId;
		for (let n = 1; seenIds.has(id); n++) {
			id = `${baseId}#${n}`;
		}
		seenIds.add(id);

		items.push({
			id,
			name: entry.title,
			subName: entry.paneName,
			keywords: `${entry.paneName} ${entry.keywords.replace(/,/g, " ")}`,
			IconComponent,
			type: ItemType.PREFERENCE_PANE,
			callback,
		});
	}

	return items;
}
