Pod::Spec.new do |s|
  s.name = 'TurtleCallAudio'
  s.version = '1.0.0'
  s.summary = 'Audio interruption handling for Turtle calls'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Turtle'
  s.homepage = 'https://github.com/sudothi/turtle'
  s.source = { :git => 'https://github.com/sudothi/turtle.git' }
  s.platforms = { :ios => '26.0' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'LiveKitWebRTC'
  s.source_files = '**/*.swift'
end
