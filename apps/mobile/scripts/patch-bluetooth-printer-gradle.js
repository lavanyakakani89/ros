const fs = require('fs');
const path = require('path');

const candidateRoots = [
  path.join(__dirname, '..', 'node_modules', 'react-native-bluetooth-escpos-printer'),
  path.join(__dirname, '..', '..', '..', 'node_modules', 'react-native-bluetooth-escpos-printer'),
];

const packageRoot = candidateRoots.find((candidate) =>
  fs.existsSync(path.join(candidate, 'android', 'build.gradle')),
);

if (!packageRoot) {
  console.warn('Bluetooth printer Gradle file not found, skipping patch.');
  process.exit(0);
}

const gradlePath = path.join(packageRoot, 'android', 'build.gradle');
const modulePath = path.join(
  packageRoot,
  'android',
  'src',
  'main',
  'java',
  'cn',
  'jystudio',
  'bluetooth',
  'RNBluetoothManagerModule.java',
);

fs.writeFileSync(
  gradlePath,
  `apply plugin: 'com.android.library'

android {
    namespace 'cn.jystudio.bluetooth'
    compileSdkVersion rootProject.ext.has('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 34

    defaultConfig {
        minSdkVersion rootProject.ext.has('minSdkVersion') ? rootProject.ext.minSdkVersion : 23
        targetSdkVersion rootProject.ext.has('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 34
        versionCode 1
        versionName "1.0"
    }

    lintOptions {
        abortOnError false
    }

    sourceSets {
        main {
            aidl.srcDirs = ['src/main/java']
        }
    }
}

repositories {
    google()
    mavenCentral()
    maven {
        url "$rootDir/../node_modules/react-native/android"
    }
}

dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
    implementation 'com.facebook.react:react-native:+'
    implementation 'androidx.core:core:1.13.1'
    implementation "com.google.zxing:core:3.3.0"
}
`,
);

if (fs.existsSync(modulePath)) {
  const source = fs.readFileSync(modulePath, 'utf8')
    .replace('android.support.v4.app.ActivityCompat', 'androidx.core.app.ActivityCompat')
    .replace('android.support.v4.content.ContextCompat', 'androidx.core.content.ContextCompat');
  fs.writeFileSync(modulePath, source);
}

console.log('Patched react-native-bluetooth-escpos-printer for Gradle 8.');
