import Foundation
import IOKit.ps

final class SettingsIndex {
  static let shared = SettingsIndex()

  private static let systemSettingsPath = "/System/Applications/System Settings.app"
  private static let extensionPoint = "com.apple.Settings.extension.ui"
  private static let searchDirectories = [
    "/System/Library/ExtensionKit/Extensions",
    "/System/Applications/System Settings.app/Contents/PlugIns",
    "/System/Library/CoreServices/Spotlight.app/Contents/Extensions",
    "/System/Volumes/Preboot/Cryptexes/App/System/Library/CoreServices",
    "/System/Library/PrivateFrameworks/PreferencePanesSupport.framework/PlugIns",
  ]

  private let queue = DispatchQueue(label: "com.ospfranco.sol.settingsIndex", qos: .utility)
  private var cached: [[String: String]]?

  func load(_ completion: @escaping ([[String: String]]) -> Void) {
    queue.async {
      if let cached = self.cached {
        completion(cached)
        return
      }
      let entries = SettingsIndex.build()
      self.cached = entries
      completion(entries)
    }
  }

  static func build() -> [[String: String]] {
    let isPortable = hasInternalBattery()
    var seenPanes = Set<String>()
    var entries: [[String: String]] = []

    for directory in searchDirectories {
      guard
        let names = try? FileManager.default.contentsOfDirectory(atPath: directory)
      else { continue }

      for name in names.sorted() where name.hasSuffix(".appex") {
        let path = (directory as NSString).appendingPathComponent(name)
        guard let pane = paneEntries(path: path, isPortable: isPortable),
          !seenPanes.contains(pane.id)
        else { continue }
        seenPanes.insert(pane.id)
        entries.append(contentsOf: pane.entries)
      }
    }

    return entries
  }

  private static func paneEntries(path: String, isPortable: Bool) -> (
    id: String, entries: [[String: String]]
  )? {
    guard let bundle = Bundle(url: URL(fileURLWithPath: path)),
      let info = bundle.infoDictionary,
      let attributes = info["EXAppExtensionAttributes"] as? [String: Any],
      attributes["EXExtensionPointIdentifier"] as? String == extensionPoint,
      let paneId = info["CFBundleIdentifier"] as? String
    else { return nil }

    let settings = attributes["SettingsExtensionAttributes"] as? [String: Any] ?? [:]
    if settings["allowsXAppleSystemPreferencesURLScheme"] as? Bool == false {
      return nil
    }

    let localized = bundle.localizedInfoDictionary
    let representedName = representationName(
      bundle: bundle, settings: settings, isPortable: isPortable)
    guard
      let paneName = representedName
        ?? nonEmpty(localized?["CFBundleDisplayName"])
        ?? nonEmpty(info["CFBundleDisplayName"])
        ?? nonEmpty(localized?["CFBundleName"])
        ?? nonEmpty(info["CFBundleName"]),
      !paneName.hasSuffix("Extension")
    else { return nil }

    let rootUrl = "x-apple.systempreferences:\(paneId)"
    let iconPath = representedName == nil ? path : systemSettingsPath
    var entries: [[String: String]] = [
      [
        "paneId": paneId,
        "paneName": paneName,
        "title": paneName,
        "keywords": "",
        "url": rootUrl,
        "iconPath": iconPath,
      ]
    ]

    if let fileName = settings["searchTermsFileName"] as? String,
      let terms = searchTerms(bundle: bundle, fileName: fileName)
    {
      for anchor in terms.keys.sorted() {
        guard let group = terms[anchor] as? [String: Any],
          let strings = group["localizableStrings"] as? [[String: Any]]
        else { continue }

        var titles: [String] = []
        var keywordsByTitle: [String: [String]] = [:]

        for string in strings {
          if isPortable, string["desktopOnly"] as? Bool == true { continue }
          if !isPortable, string["portableOnly"] as? Bool == true { continue }
          guard let title = nonEmpty(string["title"]) else { continue }
          if keywordsByTitle[title] == nil {
            titles.append(title)
            keywordsByTitle[title] = []
          }
          if let index = nonEmpty(string["index"]) {
            keywordsByTitle[title]?.append(index)
          }
        }

        for title in titles {
          entries.append([
            "paneId": paneId,
            "paneName": paneName,
            "anchor": anchor,
            "title": title,
            "keywords": keywordsByTitle[title]?.joined(separator: ", ") ?? "",
            "url": "\(rootUrl)?\(anchor)",
            "iconPath": iconPath,
          ])
        }
      }
    }

    return (paneId, entries)
  }

  private static func representationName(
    bundle: Bundle, settings: [String: Any], isPortable: Bool
  ) -> String? {
    guard let representations = settings["representations"] as? [[String: Any]] else {
      return nil
    }
    let batteryPredicate = "powersource.battery \(isPortable ? "==" : "!=") YES"
    guard
      let representation = representations.first(where: {
        $0["predicate"] as? String == batteryPredicate
      }),
      let key = nonEmpty(representation["sidebar-name"])
    else { return nil }
    let name = bundle.localizedString(forKey: key, value: nil, table: nil)
    return name == key ? nil : nonEmpty(name)
  }

  private static func searchTerms(bundle: Bundle, fileName: String) -> [String: Any]? {
    let preferred = Bundle.preferredLocalizations(from: bundle.localizations)
    for localization in preferred + ["en", "Base"] {
      if let url = bundle.url(
        forResource: fileName, withExtension: "searchTerms", subdirectory: nil,
        localization: localization),
        let data = try? Data(contentsOf: url),
        let plist = try? PropertyListSerialization.propertyList(from: data, format: nil)
          as? [String: Any]
      {
        return plist
      }
    }
    return nil
  }

  private static func nonEmpty(_ value: Any?) -> String? {
    guard let string = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
      !string.isEmpty
    else { return nil }
    return string
  }

  private static func hasInternalBattery() -> Bool {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
      let sources = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef]
    else { return false }

    return sources.contains { source in
      guard
        let description = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue()
          as? [String: Any]
      else { return false }
      return description[kIOPSTypeKey] as? String == kIOPSInternalBatteryType
    }
  }
}
