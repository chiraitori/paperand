import ExpoModulesCore
import ActivityKit

/// Reading Activity Attributes for Dynamic Island and Lock Screen
@available(iOS 16.2, *)
struct ReadingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var currentPage: Int
        var totalPages: Int
        var chapterTitle: String
        var progress: Double // 0.0 to 1.0
        var isLoading: Bool
    }
    
    var mangaTitle: String
    var mangaCoverUrl: String?
    var chapterId: String
}

/// Download Activity Attributes for tracking chapter downloads
@available(iOS 16.2, *)
struct DownloadActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var currentChapter: String
        var downloadedCount: Int
        var totalCount: Int
        var progress: Double // 0.0 to 1.0
        var queuedCount: Int
        var status: String // "downloading", "completed", "failed"
    }
    
    var mangaTitle: String
    var mangaCoverUrl: String?
}

/// Expo module for enhanced iOS Live Activities
/// Provides reading progress and download tracking on lock screen and Dynamic Island
public class ReadingActivityModule: Module {
    // MARK: - Properties
    
    @available(iOS 16.2, *)
    private var currentReadingActivity: Activity<ReadingActivityAttributes>?
    
    @available(iOS 16.2, *)
    private var currentDownloadActivity: Activity<DownloadActivityAttributes>?
    
    // MARK: - Module Definition
    
    public func definition() -> ModuleDefinition {
        Name("ReadingActivity")
        
        Events("onActivityEnded")
        
        // Check if Live Activities are supported
        Function("isSupported") { () -> Bool in
            if #available(iOS 16.2, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
            return false
        }
        
        // MARK: - Reading Progress Activity
        
        // Start a reading progress activity
        AsyncFunction("startReadingActivity") { (
            mangaTitle: String,
            mangaCoverUrl: String?,
            chapterId: String,
            chapterTitle: String,
            currentPage: Int,
            totalPages: Int,
            promise: Promise
        ) in
            guard #available(iOS 16.2, *) else {
                promise.reject("UNSUPPORTED", "Live Activities require iOS 16.2+")
                return
            }
            
            // End existing activity first
            await self.endReadingActivityInternal()
            
            let attributes = ReadingActivityAttributes(
                mangaTitle: mangaTitle,
                mangaCoverUrl: mangaCoverUrl,
                chapterId: chapterId
            )
            
            let progress = totalPages > 0 ? Double(currentPage) / Double(totalPages) : 0.0
            let contentState = ReadingActivityAttributes.ContentState(
                currentPage: currentPage,
                totalPages: totalPages,
                chapterTitle: chapterTitle,
                progress: progress,
                isLoading: false
            )
            
            do {
                let activity = try Activity.request(
                    attributes: attributes,
                    content: .init(state: contentState, staleDate: nil),
                    pushType: nil
                )
                self.currentReadingActivity = activity
                promise.resolve([
                    "activityId": activity.id,
                    "started": true
                ])
            } catch {
                promise.reject("ACTIVITY_ERROR", error.localizedDescription)
            }
        }
        
        // Update reading progress activity
        AsyncFunction("updateReadingActivity") { (
            currentPage: Int,
            totalPages: Int,
            chapterTitle: String?,
            promise: Promise
        ) in
            guard #available(iOS 16.2, *) else {
                promise.reject("UNSUPPORTED", "Live Activities require iOS 16.2+")
                return
            }
            
            guard let activity = self.currentReadingActivity else {
                promise.reject("NO_ACTIVITY", "No active reading activity")
                return
            }
            
            let progress = totalPages > 0 ? Double(currentPage) / Double(totalPages) : 0.0
            let title = chapterTitle ?? activity.content.state.chapterTitle
            
            let contentState = ReadingActivityAttributes.ContentState(
                currentPage: currentPage,
                totalPages: totalPages,
                chapterTitle: title,
                progress: progress,
                isLoading: false
            )
            
            await activity.update(
                ActivityContent(state: contentState, staleDate: nil)
            )
            
            promise.resolve(["updated": true])
        }
        
        // End reading activity
        AsyncFunction("endReadingActivity") { (promise: Promise) in
            guard #available(iOS 16.2, *) else {
                promise.resolve(["ended": true])
                return
            }
            
            await self.endReadingActivityInternal()
            promise.resolve(["ended": true])
        }
        
        // MARK: - Download Progress Activity
        
        // Start a download progress activity
        AsyncFunction("startDownloadActivity") { (
            mangaTitle: String,
            mangaCoverUrl: String?,
            totalCount: Int,
            promise: Promise
        ) in
            guard #available(iOS 16.2, *) else {
                promise.reject("UNSUPPORTED", "Live Activities require iOS 16.2+")
                return
            }
            
            // End existing download activity first
            await self.endDownloadActivityInternal()
            
            let attributes = DownloadActivityAttributes(
                mangaTitle: mangaTitle,
                mangaCoverUrl: mangaCoverUrl
            )
            
            let contentState = DownloadActivityAttributes.ContentState(
                currentChapter: "Starting...",
                downloadedCount: 0,
                totalCount: totalCount,
                progress: 0.0,
                queuedCount: totalCount,
                status: "downloading"
            )
            
            do {
                let activity = try Activity.request(
                    attributes: attributes,
                    content: .init(state: contentState, staleDate: nil),
                    pushType: nil
                )
                self.currentDownloadActivity = activity
                promise.resolve([
                    "activityId": activity.id,
                    "started": true
                ])
            } catch {
                promise.reject("ACTIVITY_ERROR", error.localizedDescription)
            }
        }
        
        // Update download progress activity
        AsyncFunction("updateDownloadActivity") { (
            currentChapter: String,
            downloadedCount: Int,
            totalCount: Int,
            queuedCount: Int,
            promise: Promise
        ) in
            guard #available(iOS 16.2, *) else {
                promise.reject("UNSUPPORTED", "Live Activities require iOS 16.2+")
                return
            }
            
            guard let activity = self.currentDownloadActivity else {
                promise.reject("NO_ACTIVITY", "No active download activity")
                return
            }
            
            let progress = totalCount > 0 ? Double(downloadedCount) / Double(totalCount) : 0.0
            
            let contentState = DownloadActivityAttributes.ContentState(
                currentChapter: currentChapter,
                downloadedCount: downloadedCount,
                totalCount: totalCount,
                progress: progress,
                queuedCount: queuedCount,
                status: "downloading"
            )
            
            await activity.update(
                ActivityContent(state: contentState, staleDate: nil)
            )
            
            promise.resolve(["updated": true])
        }
        
        // Complete download activity with success message
        AsyncFunction("completeDownloadActivity") { (
            message: String?,
            promise: Promise
        ) in
            guard #available(iOS 16.2, *) else {
                promise.resolve(["completed": true])
                return
            }
            
            guard let activity = self.currentDownloadActivity else {
                promise.resolve(["completed": true])
                return
            }
            
            let finalState = DownloadActivityAttributes.ContentState(
                currentChapter: message ?? "Download Complete",
                downloadedCount: activity.content.state.totalCount,
                totalCount: activity.content.state.totalCount,
                progress: 1.0,
                queuedCount: 0,
                status: "completed"
            )
            
            await activity.end(
                ActivityContent(state: finalState, staleDate: nil),
                dismissalPolicy: .default
            )
            
            self.currentDownloadActivity = nil
            promise.resolve(["completed": true])
        }
        
        // End download activity (cancel/fail)
        AsyncFunction("endDownloadActivity") { (promise: Promise) in
            guard #available(iOS 16.2, *) else {
                promise.resolve(["ended": true])
                return
            }
            
            await self.endDownloadActivityInternal()
            promise.resolve(["ended": true])
        }
        
        // MARK: - Utility Functions
        
        // Get current activity status
        Function("getActiveActivities") { () -> [[String: Any]] in
            guard #available(iOS 16.2, *) else {
                return []
            }
            
            var activities: [[String: Any]] = []
            
            if let reading = self.currentReadingActivity {
                activities.append([
                    "type": "reading",
                    "id": reading.id,
                    "mangaTitle": reading.attributes.mangaTitle,
                    "currentPage": reading.content.state.currentPage,
                    "totalPages": reading.content.state.totalPages
                ])
            }
            
            if let download = self.currentDownloadActivity {
                activities.append([
                    "type": "download",
                    "id": download.id,
                    "mangaTitle": download.attributes.mangaTitle,
                    "downloadedCount": download.content.state.downloadedCount,
                    "totalCount": download.content.state.totalCount
                ])
            }
            
            return activities
        }
        
        // End all activities
        AsyncFunction("endAllActivities") { (promise: Promise) in
            guard #available(iOS 16.2, *) else {
                promise.resolve(["ended": true])
                return
            }
            
            await self.endReadingActivityInternal()
            await self.endDownloadActivityInternal()
            promise.resolve(["ended": true])
        }
    }
    
    // MARK: - Private Methods
    
    @available(iOS 16.2, *)
    private func endReadingActivityInternal() async {
        guard let activity = currentReadingActivity else { return }
        
        let finalState = ReadingActivityAttributes.ContentState(
            currentPage: activity.content.state.currentPage,
            totalPages: activity.content.state.totalPages,
            chapterTitle: activity.content.state.chapterTitle,
            progress: activity.content.state.progress,
            isLoading: false
        )
        
        await activity.end(
            ActivityContent(state: finalState, staleDate: nil),
            dismissalPolicy: .immediate
        )
        
        currentReadingActivity = nil
    }
    
    @available(iOS 16.2, *)
    private func endDownloadActivityInternal() async {
        guard let activity = currentDownloadActivity else { return }
        
        let finalState = DownloadActivityAttributes.ContentState(
            currentChapter: "Cancelled",
            downloadedCount: activity.content.state.downloadedCount,
            totalCount: activity.content.state.totalCount,
            progress: activity.content.state.progress,
            queuedCount: 0,
            status: "failed"
        )
        
        await activity.end(
            ActivityContent(state: finalState, staleDate: nil),
            dismissalPolicy: .immediate
        )
        
        currentDownloadActivity = nil
    }
}
