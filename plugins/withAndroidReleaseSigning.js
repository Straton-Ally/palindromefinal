const { withAppBuildGradle } = require('@expo/config-plugins');

const SIGNING_VARS = `    def releaseStoreFilePath = findProperty('PALINDROME_RELEASE_STORE_FILE') ?: System.getenv('PALINDROME_RELEASE_STORE_FILE') ?: '../../release.keystore'
    def releaseStorePassword = findProperty('PALINDROME_RELEASE_STORE_PASSWORD') ?: System.getenv('PALINDROME_RELEASE_STORE_PASSWORD')
    def releaseKeyAlias = findProperty('PALINDROME_RELEASE_KEY_ALIAS') ?: System.getenv('PALINDROME_RELEASE_KEY_ALIAS')
    def releaseKeyPassword = findProperty('PALINDROME_RELEASE_KEY_PASSWORD') ?: System.getenv('PALINDROME_RELEASE_KEY_PASSWORD') ?: releaseStorePassword
    def releaseStoreFile = file(releaseStoreFilePath)
    def hasReleaseSigning = releaseStoreFile.exists() && releaseStorePassword && releaseKeyAlias && releaseKeyPassword

`;

const RELEASE_SIGNING_CONFIG = `        release {
            if (hasReleaseSigning) {
                storeFile releaseStoreFile
                storePassword releaseStorePassword
                keyAlias releaseKeyAlias
                keyPassword releaseKeyPassword
            }
        }
`;

const RELEASE_SIGNING_GUARD = `            if (!hasReleaseSigning) {
                throw new GradleException("Release signing is not configured. Set PALINDROME_RELEASE_STORE_PASSWORD, PALINDROME_RELEASE_KEY_ALIAS, and PALINDROME_RELEASE_KEY_PASSWORD in android/gradle.properties or environment variables. The default store file is ../../release.keystore.")
            }
            signingConfig signingConfigs.release`;

/**
 * Locates a Gradle block by matching braces, so edits can be scoped to one
 * block instead of relying on a plain `String.replace`. A non-global replace
 * only hits the first match in the whole file, which previously rewrote the
 * `debug` build type (it appears first in the Expo template) and left
 * `release` signed with the debug keystore.
 *
 * @returns {{ openIdx: number, closeIdx: number, body: string } | null}
 */
function findBlock(contents, headerRegex, fromIndex = 0) {
  const slice = contents.slice(fromIndex);
  const match = headerRegex.exec(slice);
  if (!match) return null;

  const openIdx = contents.indexOf('{', fromIndex + match.index);
  if (openIdx === -1) return null;

  let depth = 0;
  for (let i = openIdx; i < contents.length; i += 1) {
    const char = contents[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { openIdx, closeIdx: i, body: contents.slice(openIdx + 1, i) };
      }
    }
  }

  return null;
}

function replaceBlockBody(contents, block, newBody) {
  return (
    contents.slice(0, block.openIdx + 1) + newBody + contents.slice(block.closeIdx)
  );
}

function addSigningVars(contents) {
  if (contents.includes('PALINDROME_RELEASE_STORE_PASSWORD')) return contents;
  return contents.replace(/(\n[ \t]*signingConfigs[ \t]*\{)/, `\n${SIGNING_VARS}$1`);
}

function addReleaseSigningConfig(contents) {
  const signingConfigs = findBlock(contents, /\n[ \t]*signingConfigs[ \t]*\{/);
  if (!signingConfigs) {
    throw new Error(
      'withAndroidReleaseSigning: could not find a signingConfigs block in app/build.gradle'
    );
  }

  if (/\n[ \t]*release[ \t]*\{/.test(signingConfigs.body)) return contents;

  // Preserve whatever indentation sat before the block's closing brace.
  const closingIndent = /\n([ \t]*)$/.exec(signingConfigs.body)?.[1] ?? '    ';

  return replaceBlockBody(
    contents,
    signingConfigs,
    `${signingConfigs.body.replace(/\s*$/, '\n')}${RELEASE_SIGNING_CONFIG}${closingIndent}`
  );
}

/**
 * Points the `release` build type — and only the `release` build type — at
 * `signingConfigs.release`.
 */
function useReleaseSigningForReleaseBuildType(contents) {
  const buildTypes = findBlock(contents, /\n[ \t]*buildTypes[ \t]*\{/);
  if (!buildTypes) {
    throw new Error(
      'withAndroidReleaseSigning: could not find a buildTypes block in app/build.gradle'
    );
  }

  const releaseType = findBlock(contents, /\n[ \t]*release[ \t]*\{/, buildTypes.openIdx);
  if (!releaseType || releaseType.closeIdx > buildTypes.closeIdx) {
    throw new Error(
      'withAndroidReleaseSigning: could not find buildTypes.release in app/build.gradle'
    );
  }

  if (releaseType.body.includes('signingConfigs.release')) return contents;

  if (!/signingConfig[ \t]+signingConfigs\.debug/.test(releaseType.body)) {
    throw new Error(
      'withAndroidReleaseSigning: buildTypes.release has no `signingConfig signingConfigs.debug` line to replace'
    );
  }

  const patchedBody = releaseType.body.replace(
    /signingConfig[ \t]+signingConfigs\.debug/,
    RELEASE_SIGNING_GUARD.trimStart()
  );

  return replaceBlockBody(contents, releaseType, patchedBody);
}

function addReleaseSigning(appBuildGradle) {
  let contents = appBuildGradle;
  contents = addSigningVars(contents);
  contents = addReleaseSigningConfig(contents);
  contents = useReleaseSigningForReleaseBuildType(contents);
  return contents;
}

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = addReleaseSigning(config.modResults.contents);
    return config;
  });
};

module.exports.addReleaseSigning = addReleaseSigning;
