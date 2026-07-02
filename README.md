# Black Box V4

Black Box V4 is a Vercel-deployable Next.js PWA-style app for car-mounted phone recording. It captures road-facing video, GPS samples, speed, time/date, accelerometer readings, orientation readings, manual markers, and conservative "Possible High Impact" events.

Black Box is an experimental personal recording tool. It is not a certified crash detection or emergency response system.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

Push this repository to GitHub and import it into Vercel. The app uses the Next.js App Router, browser APIs, and IndexedDB only. No server database, auth provider, or environment variables are required for V1.

## Browser limitations

- Camera recording depends on `navigator.mediaDevices.getUserMedia`.
- Video recording depends on `MediaRecorder`. If unsupported, GPS and sensor logging can still continue.
- True background recording is intentionally not attempted.
- V1 records one rear-facing camera stream by default and does not attempt simultaneous front/rear recording.
- Browser GPS speed can be missing or noisy depending on device, OS, signal, and privacy settings.
- IndexedDB data is local to the browser profile and can be removed by the OS/browser.

## iPhone permission notes

- Use HTTPS in production. Localhost is acceptable for development.
- iOS motion sensors require a user gesture and `DeviceMotionEvent.requestPermission()`.
- Safari may pause or stop capture if the browser is backgrounded, the screen locks, or the tab is suspended.
- Mount the phone before tapping Start Drive, and avoid interacting while driving except after pulling over.

## Retention

Only the latest drive session is kept locally. Starting a new drive warns that it will replace the previous unprotected drive. Unprotected sessions expire after the configured retention period, defaulting to 48 hours. Save Evidence protects a session until manual deletion.

## Known limitations

- This is not certified crash evidence.
- Possible High Impact events are heuristic markers, not confirmed crashes.
- No automatic SMS or email is sent. Prepare SMS and Prepare Email only open the user's messaging client with prefilled text.
- No cloud sync, account login, encrypted vault, clip trimming, or map replay in V1.

## Future native-app roadmap

- Native iOS app with dual camera recording
- Background recording
- Automatic cloud backup
- Real SMS alerts through Twilio/ClickSend
- Google Drive upload
- Apple Shortcuts integration
- OBD-II Bluetooth integration
- Incident clip trimming
- Map replay
- Encrypted evidence vault
