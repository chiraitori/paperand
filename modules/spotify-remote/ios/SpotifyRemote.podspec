require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'expo-module.config.json')))

Pod::Spec.new do |s|
  s.name           = 'SpotifyRemote'
  s.version        = '1.0.0'
  s.summary        = 'Expo module for Spotify Remote control'
  s.description    = 'Native iOS module for controlling Spotify playback from React Native using SpotifyiOS SDK'
  s.author         = 'Paperand'
  s.homepage       = 'https://github.com/chiraitori/paperback-android'
  s.license        = 'MIT'
  s.platforms      = { :ios => '13.4' }
  s.source         = { :git => 'https://github.com/chiraitori/paperback-android.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  
  # Spotify iOS SDK
  s.vendored_frameworks = 'Frameworks/SpotifyiOS.xcframework'
  
  s.source_files = '*.swift'
  s.swift_version = '5.9'
end
