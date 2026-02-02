/**
 * Expo Config Plugin to add Live Activities Widget Extension
 * 
 * This plugin:
 * 1. Creates a Widget Extension target for Live Activities
 * 2. Adds the necessary entitlements
 * 3. Configures the widget to display reading progress
 */

const { withXcodeProject, withInfoPlist, withEntitlementsPlist, IOSConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Widget Extension Swift code
const widgetSwiftCode = `
import WidgetKit
import SwiftUI
import ActivityKit

// MARK: - Reading Activity Attributes
struct ReadingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var currentPage: Int
        var totalPages: Int
        var chapterTitle: String
        var progress: Double
        var isLoading: Bool
    }
    
    var mangaTitle: String
    var mangaCoverUrl: String?
    var chapterId: String
}

// MARK: - Download Activity Attributes  
struct DownloadActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var currentChapter: String
        var downloadedCount: Int
        var totalCount: Int
        var progress: Double
        var queuedCount: Int
        var status: String
    }
    
    var mangaTitle: String
    var mangaCoverUrl: String?
}

// MARK: - Reading Live Activity Widget
struct ReadingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ReadingActivityAttributes.self) { context in
            // Lock Screen / Banner UI
            ReadingLockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded UI
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "book.fill")
                        .foregroundColor(.orange)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\\(context.state.currentPage)/\\(context.state.totalPages)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(context.attributes.mangaTitle)
                            .font(.headline)
                            .lineLimit(1)
                        Text(context.state.chapterTitle)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                        ProgressView(value: context.state.progress)
                            .tint(.orange)
                    }
                    .padding(.horizontal)
                }
            } compactLeading: {
                Image(systemName: "book.fill")
                    .foregroundColor(.orange)
            } compactTrailing: {
                Text("\\(Int(context.state.progress * 100))%")
                    .font(.caption2)
            } minimal: {
                Image(systemName: "book.fill")
                    .foregroundColor(.orange)
            }
        }
    }
}

// MARK: - Download Live Activity Widget
struct DownloadLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DownloadActivityAttributes.self) { context in
            // Lock Screen / Banner UI
            DownloadLockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "arrow.down.circle.fill")
                        .foregroundColor(.blue)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\\(context.state.downloadedCount)/\\(context.state.totalCount)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(context.attributes.mangaTitle)
                            .font(.headline)
                            .lineLimit(1)
                        Text(context.state.currentChapter)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                        ProgressView(value: context.state.progress)
                            .tint(.blue)
                    }
                    .padding(.horizontal)
                }
            } compactLeading: {
                Image(systemName: "arrow.down.circle.fill")
                    .foregroundColor(.blue)
            } compactTrailing: {
                Text("\\(context.state.downloadedCount)/\\(context.state.totalCount)")
                    .font(.caption2)
            } minimal: {
                Image(systemName: "arrow.down.circle.fill")
                    .foregroundColor(.blue)
            }
        }
    }
}

// MARK: - Lock Screen Views
struct ReadingLockScreenView: View {
    let context: ActivityViewContext<ReadingActivityAttributes>
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "book.fill")
                .font(.title)
                .foregroundColor(.orange)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.mangaTitle)
                    .font(.headline)
                    .lineLimit(1)
                Text(context.state.chapterTitle)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                HStack {
                    ProgressView(value: context.state.progress)
                        .tint(.orange)
                    Text("\\(context.state.currentPage)/\\(context.state.totalPages)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .activityBackgroundTint(.black.opacity(0.8))
    }
}

struct DownloadLockScreenView: View {
    let context: ActivityViewContext<DownloadActivityAttributes>
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.down.circle.fill")
                .font(.title)
                .foregroundColor(.blue)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.mangaTitle)
                    .font(.headline)
                    .lineLimit(1)
                Text(context.state.status == "completed" ? "Download Complete!" : context.state.currentChapter)
                    .font(.subheadline)
                    .foregroundColor(context.state.status == "completed" ? .green : .secondary)
                    .lineLimit(1)
                HStack {
                    ProgressView(value: context.state.progress)
                        .tint(context.state.status == "completed" ? .green : .blue)
                    Text("\\(context.state.downloadedCount)/\\(context.state.totalCount)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .activityBackgroundTint(.black.opacity(0.8))
    }
}

// MARK: - Widget Bundle
@main
struct PaperandWidgetBundle: WidgetBundle {
    var body: some Widget {
        ReadingLiveActivity()
        DownloadLiveActivity()
    }
}
`;

// Widget Extension Info.plist
const widgetInfoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>$(DEVELOPMENT_LANGUAGE)</string>
    <key>CFBundleDisplayName</key>
    <string>Paperand Widget</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key>
    <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
    <key>CFBundleShortVersionString</key>
    <string>$(MARKETING_VERSION)</string>
    <key>CFBundleVersion</key>
    <string>$(CURRENT_PROJECT_VERSION)</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.widgetkit-extension</string>
    </dict>
    <key>NSSupportsLiveActivities</key>
    <true/>
</dict>
</plist>
`;

function withLiveActivitiesWidget(config) {
    // Add entitlements for main app
    config = withEntitlementsPlist(config, (config) => {
        // App Groups for sharing data between app and widget
        config.modResults['com.apple.security.application-groups'] = [
            `group.${config.ios?.bundleIdentifier || 'com.chiraitori.paperand.ios'}`
        ];
        return config;
    });

    // Modify Xcode project to add widget extension
    config = withXcodeProject(config, async (config) => {
        const xcodeProject = config.modResults;
        const projectRoot = config.modRequest.projectRoot;
        const bundleIdentifier = config.ios?.bundleIdentifier || 'com.chiraitori.paperand.ios';
        const widgetBundleId = `${bundleIdentifier}.PaperandWidget`;
        const widgetName = 'PaperandWidget';
        const widgetDir = path.join(projectRoot, 'ios', widgetName);
        
        // Create widget directory
        if (!fs.existsSync(widgetDir)) {
            fs.mkdirSync(widgetDir, { recursive: true });
        }
        
        // Write widget Swift file
        fs.writeFileSync(
            path.join(widgetDir, 'PaperandWidget.swift'),
            widgetSwiftCode.trim()
        );
        
        // Write widget Info.plist
        fs.writeFileSync(
            path.join(widgetDir, 'Info.plist'),
            widgetInfoPlist.trim()
        );
        
        // Write widget entitlements
        const widgetEntitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>group.${bundleIdentifier}</string>
    </array>
</dict>
</plist>
`;
        fs.writeFileSync(
            path.join(widgetDir, `${widgetName}.entitlements`),
            widgetEntitlements.trim()
        );
        
        // Add widget target to Xcode project
        const targetUuid = xcodeProject.generateUuid();
        const targetName = widgetName;
        
        // Check if target already exists
        const targets = xcodeProject.pbxNativeTargetSection();
        let targetExists = false;
        for (const key in targets) {
            if (targets[key].name === targetName) {
                targetExists = true;
                break;
            }
        }
        
        if (!targetExists) {
            console.log(`[withLiveActivities] Adding ${widgetName} target to Xcode project`);
            
            // Add the widget extension target
            const target = xcodeProject.addTarget(
                targetName,
                'app_extension',
                widgetName,
                widgetBundleId
            );
            
            // Add source files to target
            const swiftFile = xcodeProject.addFile(
                `${widgetName}/PaperandWidget.swift`,
                xcodeProject.getFirstTarget().uuid,
                { target: target.uuid }
            );
            
            // Add build settings
            const configurations = xcodeProject.pbxXCBuildConfigurationSection();
            for (const key in configurations) {
                const config = configurations[key];
                if (config.buildSettings && config.name) {
                    if (config.buildSettings.PRODUCT_NAME === `"${widgetName}"` || 
                        config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER === widgetBundleId) {
                        config.buildSettings.SWIFT_VERSION = '5.0';
                        config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '16.2';
                        config.buildSettings.CODE_SIGN_ENTITLEMENTS = `${widgetName}/${widgetName}.entitlements`;
                        config.buildSettings.INFOPLIST_FILE = `${widgetName}/Info.plist`;
                        config.buildSettings.LD_RUNPATH_SEARCH_PATHS = '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"';
                        config.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
                        config.buildSettings.MARKETING_VERSION = '1.0';
                        config.buildSettings.CURRENT_PROJECT_VERSION = '1';
                    }
                }
            }
        } else {
            console.log(`[withLiveActivities] ${widgetName} target already exists`);
        }
        
        return config;
    });

    return config;
}

module.exports = withLiveActivitiesWidget;
