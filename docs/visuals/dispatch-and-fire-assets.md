# Dispatch and Fire visual assets

Generated with the built-in imagegen tool on 24 October 2026. All artwork is bundled locally; no image service is called at runtime. Existing assets were preserved.

## Delivered assets

- `apps/mobile/assets/fire-home-v1.jpg` — Fire homepage background, shaded in the UI for dark and light themes.
- `apps/web/public/images/dispatch/police-v1.png` and `apps/web/public/images/dispatch/{ambulance,fire,disaster}-v2.png` — dispatcher progress strips and crew-map markers.
- `apps/mobile/assets/dispatch/police-v1.png` and `apps/mobile/assets/dispatch/{ambulance,fire,disaster}-v2.png` — matching mobile arrival-strip artwork.

Vehicle PNGs preserve transparency, trimmed and resized to 320 × 192 for small UI use. The background is compressed to a 1000-pixel-wide JPEG. Vehicle art indicates the service; it does not identify an assigned fleet vehicle. Existing tracking, ETA calculations, actions and permissions are unchanged.

## Preview and validation

- [Dispatcher preview](dispatch-preview.png), using sample crews in an isolated render of the actual tracker component.
- [Mobile arrival preview](mobile-arrival-preview.png), using mocked GPS in the actual arrival component.
- [Fire homepage preview](fire-home-preview.png), captured from Expo web with all Supabase calls intercepted.
- [Slim progress track](slim-track-preview.png): a 4 px filled rail replaces the 28 px dashed road on web and the 24 px road on mobile. Smaller milestones and vehicles resting above the rail keep the progress easy to read. Position calculations, actions, and map sizes are unchanged.

Web and mobile TypeScript checks pass. Browser checks cover all four services, narrow layouts, both themes, tracker expansion/collapse, marker movement, lifecycle states, missing map coordinates, reduced motion on web, and the existing manual-arrival actions. Fire home was checked off duty in both themes and on duty; Police retains its previous backdrop. No live duty or incident writes were made.

After a reported Metro missing-image error, the running Expo server's Android bundle returned HTTP 200. The bundle registers all four current vehicle assets, and each asset URL returns HTTP 200 with bytes identical to its local PNG. No source or Metro configuration change was needed. No app was connected to Metro's reload socket during this check, so the phone must reconnect or reload to pick up the completed bundle.

The full Expo web app reports an existing `AppRegistry.registerHeadlessTask` error from `apps/mobile/index.ts`, outside this visual change. The tested home screens render despite it. Isolated tracker/arrival previews report no browser errors. Native device rendering has not been tested in this session.

## Generation prompts

### fire-home

Use case: photorealistic-natural. Asset type: portrait background for a Fire & Rescue mobile app homepage. Cinematic editorial photograph of a professional firefighter in dark protective turnout gear, reflective yellow bands, helmet and breathing apparatus, seen from behind in the right third, standing calmly beside a softly out-of-focus red fire engine at dusk. Subtle warm amber light on helmet and shoulder, cool charcoal navy atmosphere, faint haze, realistic fabric. Wide quiet negative space on the left and upper half for UI text. Firefighter occupies right third of lower two-thirds; avoid a huge foreground subject. Portrait 2:3 composition. Low contrast, dark subdued exposure, no bright white lights, no flames, no casualties, no drama, no text, lettering, logos, badges or watermarks. The image should be an atmospheric understated background, allowing bright interface text and cards to remain legible.

Transparent background: no.

### police

Use case: stylized-concept. Asset type: small vehicle sprite for an emergency dispatch map and journey progress bar. Premium miniature 3D navigation-app vehicle, crisp clean shapes readable at 56 pixels, soft realistic materials, no text or logos. A single vehicle viewed from directly overhead with a VERY slight view of its right side, nose pointing to the RIGHT of the image, long axis horizontal. Centered, entire vehicle visible, vehicle occupies 88 percent of canvas width, square canvas with transparent background and generous clear space above and below. No ground, no scenery, no cast shadow beyond a tiny soft contact shadow. Consistent soft studio lighting. Subject: white and deep navy blue modern police patrol SUV, blue side stripe, black tires, dark panoramic windows, small red and blue roof emergency lightbar. No lettering.

Transparent background: yes.

### ambulance

Use case: stylized-concept. Asset type: small vehicle sprite for an emergency dispatch map and journey progress bar. Premium miniature 3D navigation-app vehicle, crisp clean shapes readable at 56 pixels, soft realistic materials, no text or logos. A single vehicle viewed from directly overhead with a VERY slight view of its right side, nose pointing to the RIGHT of the image, long axis horizontal. Centered, entire vehicle visible, vehicle occupies 88 percent of canvas width, square canvas with transparent background and generous clear space above and below. No ground, no scenery, no cast shadow beyond a tiny soft contact shadow. Consistent soft studio lighting. Subject: white box-bodied ambulance with rich red side stripe, white cab at right, dark windows, black tires, compact red roof emergency lightbar. No lettering, no cross symbol.

Transparent background: yes.

### fire

Use case: stylized-concept. Asset type: small vehicle sprite for an emergency dispatch map and journey progress bar. Premium miniature 3D navigation-app vehicle, crisp clean shapes readable at 56 pixels, soft realistic materials, no text or logos. A single vehicle viewed from directly overhead with a VERY slight view of its right side, nose pointing to the RIGHT of the image, long axis horizontal. Centered, entire vehicle visible, vehicle occupies 88 percent of canvas width, square canvas with transparent background and generous clear space above and below. No ground, no scenery, no cast shadow beyond a tiny soft contact shadow. Consistent soft studio lighting. Subject: red compact fire engine with silver equipment lockers, pale metal ladder on the roof, red cab at right, dark windows, black tires and red amber roof emergency lightbar. No lettering.

Transparent background: yes.

### disaster

Use case: stylized-concept. Asset type: small vehicle sprite for an emergency dispatch map and journey progress bar. Premium miniature 3D navigation-app vehicle, crisp clean shapes readable at 56 pixels, soft realistic materials, no text or logos. A single vehicle viewed from directly overhead with a VERY slight view of its right side, nose pointing to the RIGHT of the image, long axis horizontal. Centered, entire vehicle visible, vehicle occupies 88 percent of canvas width, square canvas with transparent background and generous clear space above and below. No ground, no scenery, no cast shadow beyond a tiny soft contact shadow. Consistent soft studio lighting. Subject: amber yellow and charcoal disaster-response double-cab rescue pickup with equipment canopy, yellow cab at right, dark windows, black tires and amber roof emergency lightbar. No lettering.

Transparent background: yes.


## Reference-matched replacements

The user supplied local fleet photographs after the initial generation. The final police, fire and ambulance PNGs replace the first concepts at the same web and mobile paths listed above; Disaster and the Fire homepage background retain their original art. These later prompts supersede the corresponding initial vehicle prompts. All three use the built-in imagegen tool with transparency enabled.

### Police — Toyota Corolla Cross

Use case: stylized-concept. Asset type: transparent miniature police vehicle sprite for an existing emergency dispatch map and horizontal journey progress strip.
Input images: the two user photographs are vehicle-identity and livery references, not images to reproduce as a scene. Match their eThekwini Metro Police Toyota Corolla Cross crossover accurately.
Primary request: create a clean premium miniature 3D Toyota Corolla Cross Metro Police SUV matching these photographs: compact rounded modern Corolla Cross proportions, white body and wheel arches with deep royal blue bonnet/hood and blue rear hatch, royal blue upper side band and blue mirrors, dark black windows, black wheels and tires, silver lower trim, blue emergency lightbar across the roof and small blue roof beacons. Subtle white METRO POLICE lettering on the blue hood and appropriate blue/white side markings, reflecting the reference vehicles. Toyota grille badge where visible. Keep licence plate indistinct; do not copy the specific registration number.
Composition: one single entire vehicle, nose pointing to the RIGHT, long axis perfectly horizontal. High overhead three-quarter view with the roof and right-hand side visible, like a navigation-app vehicle sprite. Match the previous generated small vehicle icons' lighting, framing and viewpoint. Center vehicle, 88 percent of canvas width, square image with transparent margin above and below.
Lighting: soft clean studio light, crisp realistic materials and simplified readable details at tiny sizes, minimal contact shadow.
Constraints: genuinely transparent background, no road, no scenery, no people, no frame, no arrows, no labels outside the vehicle, no watermark. Blue emergency lights only, no red lights. Accuracy to the supplied Toyota Corolla Cross police livery is the priority.

### fire

Use case: stylized-concept. Asset type: transparent miniature Fire & Rescue vehicle sprite for an emergency dispatch map and horizontal progress strip.
Input images: among the recent images, use ONLY the user's photograph of the YELLOW MAN ladder fire truck outside the fire station as the vehicle-identity and livery reference. Ignore the police vehicle, phone screenshots, and ambulance photograph.
Primary request: a premium miniature 3D render of that long three-axle MAN aerial ladder truck: vivid municipal yellow cab and body, charcoal-grey lower cab and black bumper, large upright flat cab with MAN grille, black wheels with silver hubs, one front axle and two closely spaced rear axles, dark-grey roller shutter equipment compartments edged in yellow, long dark charcoal telescopic ladder stowed horizontally over the roof along the full truck, chunky yellow turntable and folded aerial platform assembly at the rear, small red emergency beacons on cab. Match reference proportions and yellow/grey livery, not a red engine.
Composition: one complete truck from a high overhead three-quarter side view, nose RIGHT, long axis horizontal (not diagonal); roof and side visible. Centered, entire ladder and every wheel inside frame. Truck fills 88 percent of square canvas width, transparent margin above and below. Premium navigation-app miniature, accurate silhouette readable at 56–80 pixels. Soft studio light, crisp realistic painted metal, minimal contact shadow.
Constraints: genuinely transparent background; no road, buildings, people, other vehicles, arrows, extra labels, watermark. No invented lettering. Long three-axle silhouette, stowed ladder faithful to photo.

### ambulance

Use case: stylized-concept. Asset type: transparent miniature EMS vehicle sprite for an emergency dispatch map and horizontal journey progress strip.
Input image: the user's latest photograph of white Volkswagen ambulances is the exact identity and livery reference.
Primary request: create one premium miniature 3D Volkswagen Transporter EMS ambulance van matching these vehicles. White high long van body, compact VW flat nose and round VW grille badge, dark windows, silver steel wheels and black tires, black front bull bar, green and bright yellow checkerboard striping along the sides and upper roof edge, green-yellow lower hood stripe, red AMBULANCE lettering on white hood, compact red emergency lightbar on roof. Preserve the South African ambulance livery in the photograph. This is a VAN, not a box-bodied truck. No people inside. Avoid copying a specific unit or licence plate number.
Composition: a single complete vehicle, nose pointing RIGHT, long axis horizontal (not diagonal), high overhead three-quarter side view showing roof and side, center frame, vehicle occupies 88 percent of square canvas width, transparent margin above and below. Consistent premium navigation-app small vehicle icon, crisp shapes readable at 56–80 pixels, soft studio light, minimal contact shadow.
Constraints: transparent background, no road, landscape, lineup, other vehicles, people, frame, arrows, extra labels or watermark. Accurate green-yellow checks and white Volkswagen ambulance body. No large red side stripe.

### Ambulance cutout refinement

Use case: background-extraction. Edit this exact generated Volkswagen EMS ambulance. Preserve the vehicle's model, dimensions, angle, white paint, green and yellow checks, red AMBULANCE lettering, VW badge, windows, wheels and bull bar exactly. Remove ALL surrounding background, grey/white studio glow, mist, light bloom, ambient haze, dark backdrop and cast shadows. The background must be true transparent alpha all the way up to the clean vehicle silhouette. Preserve opaque vehicle surfaces, including the white body and windows. Do not add, redesign, rotate, recolour, relight or crop the vehicle. A clean isolated cutout ready to use at 60 pixels in a navigation map. Fully transparent background, no shadow, no glow.

## Matched perspective and compact map markers

The v2 ambulance, Fire and Disaster artwork uses the police SUV as its elevated front three-quarter camera reference: all face diagonally down-right. The police artwork is unchanged. Original v1 variants remain available but are no longer referenced by the UI. Built-in imagegen edits were used with transparency enabled. Map icons are now 40 px for the lead and 34 px for backup, with no large circular halo. The slider image dimensions and tracking behavior are unchanged.

[Ten-vehicle map preview](map-density-preview.png) uses sample positions.

### disaster v2

Use case: precise-object-edit. Asset type: matching vehicle sprite for a dispatch UI.
Image 1 is the EDIT TARGET: yellow disaster-response pickup with black equipment canopy, amber beacons, yellow rescue board and gear on canopy roof. Image 2 is the CAMERA ANGLE REFERENCE ONLY: the slanted Metro Police Toyota SUV.
Change only the target vehicle's camera perspective to match image 2 exactly. Preserve the target vehicle's identity, livery, colors, details, wheel count and proportions. Do not copy any police design elements or police lettering.
The entire vehicle must be seen from the same elevated FRONT three-quarter viewpoint as the police SUV: rear toward UPPER LEFT, nose toward LOWER RIGHT, its long axis runs diagonally downward to the right at roughly 25–30 degrees. Show roof, near side, and FRONT grille together. Camera at the same elevation and azimuth as image 2. NOT a straight side profile. NOT directly overhead. Do not merely rotate a flat side/top view. Re-render the correct 3D perspective.
One vehicle only, centered, whole silhouette and equipment uncut, generous transparent margin. Consistent crisp realistic miniature product rendering and soft studio light matching the police image. Square canvas, vehicle fills approximately 85 percent of width. True transparent background, clean silhouette, no cast shadow, glow, scenery, lettering outside vehicle or watermark.

### fire v2

Use case: precise-object-edit. Asset type: matching vehicle sprite for a dispatch UI.
Image 1 is the EDIT TARGET: yellow MAN three-axle aerial ladder fire truck, grey shutters, long dark ladder stowed over roof, yellow rear turntable and red cab beacons. Image 2 is the CAMERA ANGLE REFERENCE ONLY: the slanted Metro Police Toyota SUV.
Change only the target vehicle's camera perspective to match image 2 exactly. Preserve the target vehicle's identity, livery, colors, details, wheel count and proportions. Do not copy any police design elements or police lettering.
The entire vehicle must be seen from the same elevated FRONT three-quarter viewpoint as the police SUV: rear toward UPPER LEFT, nose toward LOWER RIGHT, its long axis runs diagonally downward to the right at roughly 25–30 degrees. Show roof, near side, and FRONT grille together. Camera at the same elevation and azimuth as image 2. NOT a straight side profile. NOT directly overhead. Do not merely rotate a flat side/top view. Re-render the correct 3D perspective.
One vehicle only, centered, whole silhouette and equipment uncut, generous transparent margin. Consistent crisp realistic miniature product rendering and soft studio light matching the police image. Square canvas, vehicle fills approximately 85 percent of width. True transparent background, clean silhouette, no cast shadow, glow, scenery, lettering outside vehicle or watermark.

### ambulance v2

Use case: precise-object-edit. Asset type: matching vehicle sprite for a dispatch UI.
Image 1 is the EDIT TARGET: white VW EMS van with green-yellow checks, red AMBULANCE lettering and roof lightbar, VW grille badge and bull bar. Image 2 is the CAMERA ANGLE REFERENCE ONLY: the slanted Metro Police Toyota SUV.
Change only the target vehicle's camera perspective to match image 2 exactly. Preserve the target vehicle's identity, livery, colors, details, wheel count and proportions. Do not copy any police design elements or police lettering.
The entire vehicle must be seen from the same elevated FRONT three-quarter viewpoint as the police SUV: rear toward UPPER LEFT, nose toward LOWER RIGHT, its long axis runs diagonally downward to the right at roughly 25–30 degrees. Show roof, near side, and FRONT grille together. Camera at the same elevation and azimuth as image 2. NOT a straight side profile. NOT directly overhead. Do not merely rotate a flat side/top view. Re-render the correct 3D perspective.
One vehicle only, centered, whole silhouette and equipment uncut, generous transparent margin. Consistent crisp realistic miniature product rendering and soft studio light matching the police image. Square canvas, vehicle fills approximately 85 percent of width. True transparent background, clean silhouette, no cast shadow, glow, scenery, lettering outside vehicle or watermark.

