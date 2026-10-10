#!/usr/bin/env bash
# Runs every suite against the files in gym/public.
#   cd gym/test && npm install && ./run-all.sh
# The older suites in gym/docs expect the app files beside them, so everything
# is copied into a throwaway directory first. Nothing in the repo is modified.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
GYM="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$GYM"/public/*.js "$GYM"/public/*.css "$GYM"/public/index.html "$GYM"/public/manifest.webmanifest "$TMP"/
cp -r "$GYM"/public/content "$TMP"/content
cp "$GYM"/docs/{tests,uitest,regression}.js "$HERE"/*.test.js "$HERE"/simkit.js "$HERE"/uikit.js "$TMP"/
[ -d "$HERE/node_modules" ] && ln -s "$HERE/node_modules" "$TMP/node_modules"
cd "$TMP"
export RECOMP_GYM="$GYM"      # lets auth.ui.test.js find the real backend for its end-to-end part
status=0
for t in tests regression uitest doubleprog.test doubleprog.ui.test library.test plan.test garmin.test coaching.ui.test auth.ui.test settings.ui.test; do
  [ -f "$t.js" ] || continue
  printf '\n== %s\n' "$t"
  node "$t.js" > "$TMP/$t.log" 2>&1; rc=$?
  tail -3 "$TMP/$t.log"
  [ "$rc" -eq 0 ] || { status=1; grep -E 'FAIL' "$TMP/$t.log" | head -20; }
done
# backend (node:sqlite) suites
if [ -d "$GYM/backend/test" ]; then
  for t in api signup ai weekly security; do
    printf '\n== backend %s\n' "$t"
    (cd "$GYM/backend" && node "test/$t.test.js" > "$TMP/be-$t.log" 2>&1); rc=$?
    tail -3 "$TMP/be-$t.log"
    [ "$rc" -eq 0 ] || { status=1; grep -E 'FAIL' "$TMP/be-$t.log" | head -20; }
  done
fi
exit $status
