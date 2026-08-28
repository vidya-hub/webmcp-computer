#!/bin/sh
for a in "$@"; do
  case "$a" in --desktop-pref|--desktop-pref=*) exit 0 ;; esac
done
exec /usr/bin/pcmanfm.real "$@"
