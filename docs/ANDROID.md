# Android companion app

What it does on your phone:
- Measures which apps you use and for how long (the same data Digital Wellbeing uses) and sends it to your server, so game time is measured instead of declared.
- Shows an ongoing notification that counts down to the end of your day, with tasks done and game time left.
- Warns you, once, when game time is nearly gone, and again if you keep playing past it (only while a game app is open; never on days that do not count, never in "just show data" mode).
- Adds two quick-settings tiles: **I'm up** (log your wake-up) and **Timer** (start or stop the timer you chose).
- Can detect your wake-up for you: the first phone use after a quiet gap of 3 hours or more (see "Wake-up detection").

```
phone usage data -> app (queue on the phone) -> your server -> Insights, game time, wake-up
                         ^ works offline, uploads when it can
```

## Install on your phone (sideload)
1. On the phone: Settings > About phone > tap Build number 7 times, then Settings > Developer options > turn on **USB debugging**.
2. On the Mac, with the phone connected by USB:
```bash
cd android
export JAVA_HOME=$(/usr/libexec/java_home -v 21)     # any JDK 17 or newer works
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
(No USB? Copy `app-debug.apk` to the phone and open it; allow "install unknown apps" for your file manager when asked.)

## Set it up
1. In the web app: **More > Connect a device**, type a name, choose **Android phone**, create the token (shown once).
2. In the Android app: enter your server address (must be `https://...` for a real server) and the token, tap **Save and test connection**. It should say "Connected".
3. **Permissions** (the three rows in the app):
   - **Usage access**: tap the button, pick Life Game, switch it on. Without this nothing is measured.
   - **Notifications**: allow.
   - **Battery**: choose "unrestricted". On Samsung also open Settings > Apps > Life Game > Battery > **Unrestricted**, and make sure Life Game is not in Battery > Background usage limits > Sleeping or Deep sleeping apps. Otherwise One UI may stop it.
4. Tap **Start tracking**. The countdown notification appears.
5. Swipe down twice, tap the pencil (edit), and drag **I'm up** and **Timer** into your quick settings.
6. In the web app, open **Insights**: phone apps appear under "Label these". Give each a category (games = Gaming) and game time starts counting.

## Wake-up detection
In the web app: **Plan > Your rules > How is your wake-up recorded?** and pick the phone option. The wake-up is then the first phone activity after a quiet gap of 3 hours or more, if that happened within the last 18 hours. A long single session (reading for hours) does not count as quiet. You can still tap "I'm up" yourself; whichever comes first for the day is kept.

## What is sent
| Sent | Not sent |
|---|---|
| App name and package id, start time, how long it was in the foreground | what you do inside apps, messages, typed text, screenshots |
| Screen on, screen off, unlock times | your location, contacts, notifications from other apps |
| Your taps on "I'm up" and the timer | |

The token is stored encrypted with a key that never leaves the phone's secure hardware. Data waits in a queue on the phone and is deleted from it once the server has it.

## If something is off
| Symptom | Check |
|---|---|
| "Waiting for the server…" | Wrong address or token. Tap "Save and test connection" and read the message. |
| Usage shows nothing | Usage access is off, or the phone has not been used since tracking started. |
| Tracking stops after a while | Battery restriction (see step 3). A 15-minute backup job still uploads even if the service is stopped, but the countdown and nudges need the service. |
| "The server does not accept this token" | The device was revoked. Create a new token. |

## Not built yet
- **Blocking** games when game time is over. The app only nudges. A friction overlay is a possible later step.
- A release build with your own signing key. The debug build above is fine for your own phone.

## Not yet verified
Built and tested on an emulator (Android 14), with 46 unit tests. **Not yet tried on a real Samsung S23:** how One UI's battery management treats the service, real usage numbers, or the wake-up detection over a real night. It has also not talked to a deployed HTTPS server.
