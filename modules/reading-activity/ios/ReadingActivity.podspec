require 'json'

Pod::Spec.new do |s|
  s.name           = 'ReadingActivity'
  s.version        = '1.0.0'
  s.summary        = 'Expo module for iOS Live Activities'
  s.description    = 'Native iOS module for displaying reading progress and download status on lock screen and Dynamic Island'
  s.author         = 'Paperand'
  s.homepage       = 'https://github.com/chiraitori/paperback-android'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.2' }
  s.source         = { :git => 'https://github.com/chiraitori/paperback-android.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  
  # ActivityKit is part of iOS SDK, no additional dependency needed

  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
