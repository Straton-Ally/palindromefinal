#!/usr/bin/env bash
# Create an Apple Distribution certificate from Windows (Git Bash) without a Mac.
#
#   Step 1:  bash scripts/ios-dist-cert.sh csr  "you@example.com" "Your Name"
#            → upload ~/apple-signing/dist.csr at developer.apple.com
#              (Certificates → + → Apple Distribution), download distribution.cer
#              into ~/apple-signing/
#   Step 2:  bash scripts/ios-dist-cert.sh p12  "<choose-a-password>"
#            → ~/apple-signing/dist.p12 and dist.p12.base64.txt (GitHub secret value)
#
# Files are kept OUTSIDE the repo. Never commit them; the repo is public.
set -euo pipefail

DIR="$HOME/apple-signing"
mkdir -p "$DIR"
cd "$DIR"   # relative paths: Windows openssl + MSYS path conversion safe

case "${1:-}" in
  csr)
    email="${2:?email required}"; name="${3:?name required}"
    if [ -f dist.key ]; then
      echo "Refusing to overwrite existing $DIR/dist.key"; exit 1
    fi
    openssl genrsa -out dist.key 2048
    MSYS_NO_PATHCONV=1 openssl req -new -key dist.key -out dist.csr \
      -subj "/emailAddress=$email/CN=$name/C=GB"
    echo "CSR written to $DIR/dist.csr"
    ;;
  p12)
    pass="${2:?password required}"
    cer=distribution.cer
    [ -f "$cer" ] || { echo "Put the downloaded distribution.cer in $DIR first"; exit 1; }
    openssl x509 -inform DER -in "$cer" -out dist.pem
    # -legacy keeps the p12 readable by macOS keychain (OpenSSL 3 default ciphers aren't).
    legacy=""; openssl pkcs12 -help 2>&1 | grep -q -- "-legacy" && legacy="-legacy"
    openssl pkcs12 -export $legacy -inkey dist.key -in dist.pem \
      -out dist.p12 -passout "pass:$pass"
    base64 -w0 dist.p12 > dist.p12.base64.txt
    echo "Done. Paste the contents of $DIR/dist.p12.base64.txt into secret IOS_DIST_CERT_P12_BASE64"
    ;;
  *)
    sed -n 2,13p "$0"; exit 1 ;;
esac
