# Native app branding

Exports of the platform's existing `apps/web/public/hiktech-brand.svg`.
The launcher uses the original red H letterform; the splash adds the full
wordmark with silver TECH lettering for contrast against `#050510`.

| Asset | Size | Use |
| --- | --- | --- |
| icon.png | 1024 x 1024 | Opaque standalone app icon |
| adaptive-icon.png | 1024 x 1024 | Transparent Android launcher foreground |
| monochrome-icon.png | 1024 x 1024 | White alpha mask for Android themed icons |
| splash.png | 1024 x 1024 | Transparent native launch artwork |
| notification-icon.png | 96 x 96 | White alpha mask for Android notifications |

Adaptive, monochrome and splash artwork fits the central two-thirds circle,
so Android's circular masks do not clip the logo. Android supplies the launcher
background and mask. The splash plugin uses a 288 dp image area on the same
dark background. Expo generates the native density variants during the build.

Regenerate from the repository root with:

```sh
node scripts/generate-mobile-branding.mjs
```

The script uses Sharp from the installed Expo image tooling. App installation
does not run it: the exported PNG files are included in source control.
Native icons and launch screens require a new APK; an OTA update cannot replace
them. Verify the result on the installed field-test APK.
