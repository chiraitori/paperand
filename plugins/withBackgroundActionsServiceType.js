const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Expo config plugin to add foregroundServiceType="dataSync" to the
 * RNBackgroundActionsTask service for Android 14+ compatibility.
 */
function withBackgroundActionsServiceType(config) {
    return withAndroidManifest(config, async (config) => {
        const manifest = config.modResults;
        const application = manifest.manifest.application?.[0];

        if (!application) {
            console.warn("withBackgroundActionsServiceType: No application found in manifest");
            return config;
        }

        // Find existing services or create the array
        if (!application.service) {
            application.service = [];
        }

        // Check if RNBackgroundActionsTask service already exists
        const existingService = application.service.find(
            (service) =>
                service.$?.["android:name"] === "com.asterinet.react.bgactions.RNBackgroundActionsTask"
        );

        if (existingService) {
            // Add foregroundServiceType to existing service
            existingService.$["android:foregroundServiceType"] = "dataSync";
        } else {
            // Add the service if it doesn't exist (library should add it, but just in case)
            application.service.push({
                $: {
                    "android:name": "com.asterinet.react.bgactions.RNBackgroundActionsTask",
                    "android:foregroundServiceType": "dataSync",
                },
            });
        }

        return config;
    });
}

module.exports = withBackgroundActionsServiceType;
