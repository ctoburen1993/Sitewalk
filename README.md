# SiteWalk Takeoff

A phone web app for sitework estimating. It works from a GPS site walk plus USGS 3DEP LiDAR ground elevations.

## Put it on your phone
iPhone only allows GPS on an **https://** address, so the folder needs to be hosted. Any static host works:

- **Netlify Drop** (easiest): go to app.netlify.com/drop and drag this folder onto the page. You get an https link right away.
- **GitHub Pages**: push this folder to a repo, then turn on Settings → Pages.

Open the link in Safari, tap Share, then **Add to Home Screen**. It opens full-screen like a regular app.
The first time you start a walk, allow Location.

## iPhone and Android
It's the same app on both, so there's nothing separate to install from an app store.
- **iPhone:** open the link in **Safari**, tap Share, then **Add to Home Screen**.
- **Android:** open the link in **Chrome** and tap **Install app** (or ⋮ → Add to Home screen). On Android you can also use **Sites → 📲 Install on this phone**.

Allow Location the first time. On Android, the back button closes any open popup. The app shell works offline once it's installed; map tiles and USGS elevations still need signal.

## Send to office (field → computer)
Tap **📤 Send to office**. It's on the Takeoff list, on each item's price card, on the Estimate tab, and at the top of **⇪ Export**.

**First time:** the app asks for your **office email address** and saves it on the phone. To change it later, tap **Change** in the Send to office box, or **Change office email** in Export.

**What it sends.** These are checked by default, and the app remembers your choice:
- **Job file** (`.sitewalk.txt`), which opens the whole job on your computer
- **Site drawing** (Letter PDF)

You can also add the **Takeoff spreadsheet** and a **Proposal** draft.

**Sending it:**
1. Tap **Send**. The phone's share sheet opens.
2. Pick **Mail** or **Gmail**.
3. The office address is already copied, so tap **To** and **paste**, then send.

Phones don't let an app fill in the To line on a shared email, which is why the address is copied for you. If the phone can't share the files (some Android phones and Excel files), they save to Downloads instead, and an email opens already addressed to the office for you to attach them.

**On the computer:**
1. Open your SiteWalk link in Chrome or Edge.
2. Click the job name at the top left, choose **Import**, and pick the `.sitewalk.txt` file from the email.
3. Adjust the rates, prices and equipment, then save the proposal PDF, print the drawing, or export to Excel.

## Export / email to yourself
Tap **⇪ Export** (top bar, Estimate tab, site plan or proposal) and pick what to send:
- **Takeoff spreadsheet**: Excel (.xlsx) with live formulas and a Rates tab
- **Proposal**: PDF, with the site plan as page 2
- **Site drawing**: PDF with a drawing border and title block, Letter 8½×11, Tabloid 11×17, or both
- **Takeoff CSV** and **Job file** (.sitewalk.json, to reopen the job on another device: Sites → Import)

**Email / Share** opens the phone's share sheet; choose Mail or Gmail and send it to yourself. If the phone can't share that file type (Android Chrome can't share .xlsx), the files download as one .zip and a new email opens addressed to you, ready for the attachment. **Download** saves the files (as a .zip when there's more than one).

The site drawing's title block fills in your company from the Proposal screen, plus the job, client, scale, date and proposal number.

## Tips while you work
The app explains what it's looking for as you go:
- **On the Takeoff screen:** when you type a work item and pick LF, Area or Count, a yellow tip card says what to mark. For example, for a driveway: "Walk down the middle of the driveway." If the unit doesn't fit (Count for a driveway), it suggests the right one.
- **Before you lay out an item:** a tip pops up with what to mark, how the app figures it, an example, and GPS tips. Check **Don't show this tip again** once you know it.
- **💡 in the drawing bar** brings the tip back while you're marking.
- **Boundary:** a tip for clicking corners or tracing your steps before you start.
- **💡 Tips** on the Takeoff tab lists every tip, including "LF, SF or count — which one?". It can also turn the pop-ups back on, or off.

## County tax maps & finding property corners
**▤ Map layers → 🗺 Tax parcel map** (also on the Site tab next to the property line) shows county tax parcel lines on the map in yellow.
- **Free online county maps:** Cherokee, Forsyth, Hall, Bibb, Chatham, Clarke, Clayton, Cobb, Columbia, Coweta, DeKalb, Douglas, Fayette, Fulton, Muscogee, Paulding and Richmond. Pick the county once. For any other county with a public ArcGIS parcel layer, paste its link.
- **Lumpkin, Dawson, White, Union and others** don't publish a free online tax map. Buy the parcel shapefile from the county GIS office (Lumpkin County GIS: 706-864-6894) and use **📥 Import parcel file…** with the .zip (it must include the .prj file). GeoJSON and KML also work. It's stored on the phone, works offline, and covers the whole county.
- **Tap a parcel** to see the parcel number, owner, address and acres, then:
  - **Use as property boundary**, which sets the boundary from the tax map, or
  - **📍 Find the corners**.
- **Starting a takeoff:** **Mark area / property boundary** now has a third choice, **🗺 Use the county tax map**.

**Find corners** works with a tax-map parcel or with your own boundary (Site tab → 📍 Find corners). A bar at the top shows the selected corner, the **distance in feet**, and an **arrow and bearing** from where you're standing. These update as you walk.
- When you find the pin, stand on it and tap **📍 Found it — mark here**. The app averages GPS for 3 seconds and tells you how far the pin is from the tax map.
- **Use found corners** updates the boundary with the real pin locations.

Tax maps are often off 10–50 ft, and phone GPS adds 10–30 ft more. Look for the iron pin, rebar or monument once you're within about 30 ft; a metal detector helps. This is for pricing, not a survey.

## Sharper map imagery
Tap **▤ Map layers → 🔍 Find the sharpest imagery here**. The app tests several free imagery sources at your site:
- **Esri World Imagery**, the standard map
- **Esri Clarity**, older photos picked for sharpness
- **Esri Wayback** releases from past years, which are sometimes sharper or taken with the leaves off
- **USGS National Map** imagery

For each one it finds how far you can really zoom in (detail to zoom 19, 20, 21…) and scores how sharp the photo is on the same spot. The list shows the sharpest first, with stars. Tap **Use** on any source; the job remembers your choice. **Back to standard Esri imagery** undoes it.

The test also runs by itself after you set the boundary. If a clearly sharper source exists there, the app switches to it and tells you.

Google and Bing photos can't be shown inside SiteWalk (their terms don't allow it), so the same screen has **Google Maps** and **Bing Maps** buttons that open your site in their apps for comparison.

## Opening the app
Tap the **SiteWalk** icon (the yellow excavator). The app opens on a blue start screen with the logo. Tap the yellow **Start takeoff** button and type the **project name** (for example, *Smith residence, Lot 4*). The name appears on the takeoff, drawing, proposal and emails. To pick up an earlier job, tap **Open a saved job** instead.

1. **Map.** The hybrid satellite map (imagery plus road and place labels) opens where you're standing.
2. **Boundary.** Tap **Mark area / property boundary**, then choose how to mark it:
   - **Click corners:** walk to each corner and tap **Mark corner** (GPS is averaged for about 3 seconds), or tap the corners on the map.
   - **Have the app trace my steps:** walk the line. The app follows your phone, closes the loop and straightens the GPS wiggle.
3. **Takeoff.** Once the boundary is set, the app pulls USGS LiDAR for the site, turns on contours, and opens the **Takeoff** screen. Example items are listed in grey; tap one or type your own.
4. **Each item:**
   - Type the work, for example *Dig utility trench*.
   - Choose **LF**, **Area** or **Count**, and pick the equipment from the drop-down. The app makes a starting guess for both from what you typed.
   - Tap **📏 Lay it out on the map**, then walk it, tapping **Mark** at each bend or **〰 Trace** to follow your steps. You can also tap it on the map.
   - Tap **Done**. The app shows that item's material, labor, equipment, fuel, overhead, profit and item price, and adds it to the takeoff.
5. Tap **＋ Next work item** and repeat. When you're done, open **Estimate** for the full sheet, proposal and export.

## Takeoff first, then measure in the field
The **☰ Takeoff** tab is where the job gets priced. List the work, then measure each line on the live map. It works like a paper takeoff, except you measure in the field instead of off a plan.

1. Tap **＋ Add line** and pick the work from your item library, like *Dig utility trench & backfill*.
2. On the line, set the **equipment** (checked machines are marked ✓), the **rate per hour** and **material $ per unit**.
3. Tap **📏 Measure on the map** and walk it or tap it:
   - **Length (LF)**, for trenches and fence: walk the run and tap **Mark** at each bend, tap **〰 Trace** and just walk, or tap here-to-there on the map.
   - **Area (SF, acres, 1,000 SF)**, for clearing, seeding and demo: walk or tap around the outline.
   - **Count (EA)**, for trees: stand at each one and tap **Mark #n**, or tap them on the map.
   - **Volume (CY)**, for topsoil: outline × the depth you set.
   - **Stone (TON)**: a driveway centerline × width, or an outline, × depth.
   - **Building pad**: the house corners plus the slab elevation (see below).
   - **Grade to elevation**: an outline, with cut and fill from the LiDAR surface.
   - **Hours** and **Lump sum** are typed in, not measured.
4. You can measure a line in more than one piece. For example, two trench runs both add to one LF line. Remove a piece with ✕, or type the quantity instead.

Each measured line shows on the map and the site drawing in its own color with its line number. Tap it on the map to open it. Lines you haven't measured yet are flagged and left out of the price.

**Item library.** In Add line, tap **Edit library…** to rename items or change the default units, equipment, rates, material $ and debris loads. Use **Custom line…** to add your own item. **Save as my default** on any line copies its machine and rates back to the library. The library is saved on the phone and used on every job.

**Equipment.** Picking a machine that isn't checked for the job checks it for you. If you switch a line to a slower machine, the rate per hour scales with the machine's speed. If you uncheck a machine in 🚜 Equipment, its lines move to the best checked machine that can do the work.

**Automatic lines.** These are added to the estimate for you: debris haul-off (from the debris loads on clearing and demo lines), fill import or dirt haul-off (from the pads and grading balance), seeding the pad side slopes, equipment delivery, and the truck/trailer.

## Marking features
Features are reference marks on the map and drawing. They are **not priced by themselves**. Tap **＋ Add feature**, then pick Single, Outline or Tree cloud. Describe the feature and set its status: Existing (green), Remove (red) or New (blue). To price a feature, open it and tap **＋ Takeoff**. That makes a takeoff line using the feature's shape: a tree adds to the matching tree-removal count, a cloud becomes clear & grub by density, a shed becomes demolish, a house becomes a building pad, and a driveway becomes stone.

Jobs started in older versions are converted automatically: work areas and red/blue features become takeoff lines.

## Building pad
Add a **Building pad** item (for example, type *Grade building pad*) and lay out the **house corners**. Walk to each corner and tap Mark, or tap them on the map. When you tap **Done**, the app pulls ground elevations for the pad if it doesn't have them yet, then asks for the **finish slab elevation**:
- It shows the ground at the house corners (low, average, high) from the USGS data.
- Type the finished floor elevation, for example 421.5, or tap a suggestion:
  - **High corner + 6"**
  - **Balance cut & fill**: the slab where the cut covers the fill plus 35%
- Tap **Figure cut & fill**.

The app then:
- **Sets the pad top** at slab − 10" (4" slab + 6" stone), so 421.5 gives a pad at 420.67 ft.
- **Sizes the pad** to run 6 ft past the house on every side.
- **Slopes the edges at 3:1** up or down until they meet existing grade, using the LiDAR contours. This gives cut and fill for the whole pad, slopes included.
- **Adds 35% to the fill** for compaction loss ("dirt needed"), then shows the net import or the extra dirt.

The price card shows the finish slab, pad elevation, cut and fill, with a **Change** button. In the item's details (Edit details), the **Finish slab elevation** box is at the top. Offset, side slope, slab and stone thickness, compaction % and topsoil strip are under **Pad settings**. **Cut and fill are shaded across the pad**, red where you cut and blue where you fill (darker means deeper), with a Cut / Fill key at the top of the map. The shading stays on the map for every pad, and it's printed on the site drawing with a legend entry.

## Driveway stone
**Driveway stone** defaults to centerline × 12 ft width × 6" thick at 1.5 tons/CY plus 15% compaction, with optional fabric.

## Takeoff sheet (Estimate tab)
Set up for a **one-man crew with rented equipment**, using starting rates researched for **Dahlonega, GA (Lumpkin County)** in Nov 2026. Every number is editable under **Rates**.

| Item | Starting value | Basis |
|---|---|---|
| Operator (you) | $30/hr + 20% burden | BLS: Gainesville GA metro construction trades average $25.16/hr (May 2024) |
| Diesel | $6.00/gal | Your number |
| Excavator, 13–15 ton | $850/day · $2,400/wk · $6,200/4 wk · $350 delivery each way · 3.5 gal/hr | Gainesville / Atlanta rental listings |
| Mini excavator w/ blade, 5–6 ton | $450 · $1,500 · $4,000 · $200 · 2.0 gal/hr | Atlanta rental planning ranges |
| Small dozer (D3 / 650) | $650 · $1,500 · $3,700 · $250 · 4.0 gal/hr | Sunbelt / United / H&E Atlanta |
| Ride-on trencher | $280 · $980 · $2,600 · $150 · 1.5 gal/hr | Sunbelt / United Atlanta |
| Dump truck hire with driver | $110/hr | Estimate — get a local quote |
| Rental damage waiver / sales tax | 12% / 8% | Typical waiver; Lumpkin County tax 8% |
| Crusher run / GAB, delivered | $32/ton | Estimate — get a quarry quote |
| Fill dirt, delivered | $25/CY | Tri-axle loads run about $150–450 for 10–12 CY |
| Topsoil, delivered | $40/CY | Estimate |
| Seed & straw by hand | about $67 per 1,000 SF | KY-31 fescue $90/50 lb at 7 lb, 10-10-10 at 20 lb, lime at 50 lb, 2 wheat straw bales ($16.49) |
| Overhead / profit | 15% / 12% | Small-outfit starting point |

How a line is priced:
- **Operator hours** = quantity ÷ production rate.
- **Labor** = hours × your rate + burden.
- **Fuel** = run hours × gal/hr × diesel price.
- **Equipment** = the rental for the days each machine is on rent, at the cheapest mix of day, week and 4-week rates (plus waiver and tax), spread over the lines that used that machine.
- **Delivery and pickup** for each machine is a Mobilization line. Hauling uses a hired truck (hourly) plus a dump fee per load.

What the work covers:
- Trees are pushed over and dug out with the excavator (no stump grinding).
- Pads are graded with the dozer, or the mini excavator blade (set in Rates; about half the production).
- Trenches are dug with the ride-on trencher.
- Pad side slopes are seeded and strawed by hand automatically. Add more with a **Seed & straw** takeoff line.

**Material prices & quotes.** Tap **📋 Material prices** (on the Takeoff list or the Estimate tab) and enter quotes as you get them. Each material has a price, the supplier or trucking company, phone, quote date and notes.
- **Built in:** fill dirt delivered ($/CY), topsoil, crusher run / GAB ($/TON), geotextile fabric, silt fence, grass seed, fertilizer, lime, straw, hired dump truck ($/HR), and the debris and dirt dump fees.
- **＋ Add material** adds anything else, such as drain pipe, culverts or erosion matting, with its own unit.
- **Use this price on new jobs too** (checked by default) saves the quote for future takeoffs. Uncheck it to use the price on this job only.
- **Fill dirt** is priced whenever pads and grading need more dirt than they cut. A building pad's price card shows the CY to bring in with an **Enter quote** button.
- **On any takeoff item**, the **Material** drop-down links it to a price on your list, and the item updates when the quote changes. Driveway stone and silt fence are linked from the start.
- **The Excel export** lists every material price with its supplier and quote date on the Rates tab.

**Editing the estimate.** Everything on the Estimate sheet can be changed:
- **Tap any line's name (✎)** to change its description, quantity, rate per hour or material $ per unit.
  - You can also type your own **labor, equipment, fuel or material $** (leave a box blank to keep the calculated amount).
  - Or bill the line as a **lump sum**, one amount that replaces all of them.
  - Edited lines get an orange edge and the word "edited". **Reset** puts one line back, **Undo all edits** puts the whole sheet back.
  - **Remove** takes a line off the estimate, and **Restore** brings removed lines back.
- **＋ Add lump sum** adds a description and an amount in any section, such as a permit fee, culvert pipe or rock allowance. It also shows on the Takeoff tab.
- **Overhead & profit:** type a percent, or a dollar amount to use instead for this job. Clear the $ box to go back to the percent.
- **Delivery & pickup $** in the Equipment table can be typed per job for any machine, including your truck and trailers (a mobilization charge). In **Edit / add equipment**, each machine has a default delivery charge, counted either **each way (× 2)** or **one time, round trip**.
- A quantity changed on the sheet changes the price, not the measurement on the Takeoff tab, so check the wording in the proposal's scope of work too.

**Schedule check.** Line items add up to operator hours and days (at your hours per day). Enter how many working days you think the whole job takes:
- The app shows labor from the line items next to labor for your schedule, and the difference.
- You choose what the bid uses: the higher of the two (the default), line items only, or your schedule.
- The Equipment rental table shows the days each machine is on rent. **Keep every machine N days** rents them for your whole schedule.

**Burn ban.** Lumpkin, Dawson and Hall counties are under Georgia EPD's summer open-burning ban from May 1 to September 30. The "Burn on site" debris option is for October–April only, with a permit.

## Equipment
Tap **🚜 Equipment** in the top bar, or **Choose equipment** on the Estimate tab.
- **Check list:** a drop-down of check boxes. Check the machines this job needs and the takeoff re-prices right away.
- **Starting list:** Silverado 2500 Truck, Small trailer, Large Gooseneck trailer, Kubota Tractor, Kubota KX-040 Mini excavator, Kubota KX80 Excavator, Case Bulldozer, Trencher, Bobcat T76, Kubota SCL1000 Skid Steer. Phones that saved the older generic list get these names on the next update, and keep any prices they changed. Everything is **owned** except the **Case Bulldozer** and the **Bobcat T76**, which are rented. Owned machines have no delivery charge (you haul them yourself), no rental waiver or tax, and can be billed by the hour. Each has a **$/hour, $/day and $/week** rate, plus gal/hr and delivery each way.
- **Picking the machine for each job:** the app uses the best checked machine that can do the work.
  - **Digging and clearing:** excavator, else mini excavator.
  - **Grading and spreading:** bulldozer, else Bobcat, skid steer, mini excavator or tractor, at a lower speed.
  - **Trenching:** trencher, else mini excavator.
  - **Truck and trailers:** priced for every day of the job.
- **Bill by:** in the Equipment table, choose Cheapest, Hour, Day or Week for each machine, and set the days. "Cheapest" uses day/week for rented machines (yards have a 1-day minimum) and can use hourly for equipment you own.
- **Edit / add equipment** (at the bottom of the Equipment list) opens your machines.
  - Tap a machine to change its name, $/hour, $/day and $/week, owned or rented, delivery each way, fuel gal/hr, what it's used for (dig & clear, grade & spread, trench, truck/trailer), speed %, and whether it starts checked on new jobs. **Delete** is on the same screen (tap it twice).
  - **＋ Add new equipment** adds a machine. It's checked for the current job unless you uncheck **Use it on this job**.
  - Changes save on the phone as you go and are used for every future takeoff.
- **Share your list with others:** in **Edit / add equipment**, tap **📤 Share list** and send the small `SiteWalk_equipment_list.txt` file. The other person taps **📥 Load list…**, picks the file, looks it over and taps **Use this list**.


## Proposal
**Estimate → Proposal** builds a letter-size proposal for the owner or GC. It includes:
- Your company block (saved once)
- Client and job info, proposal number and date
- A numbered scope of work written from the takeoff (you can edit it)
- A lump-sum price (rounded up to the nearest $50, or type your own), with an optional breakdown by section
- What's not included, terms, signature lines, and the site plan attached

**Save proposal** gives an HTML file that opens and prints in any browser. **Print / PDF** is on the phone build. **Copy email** writes a cover note to send with it.

## Field workflow
1. **Site**: search the address (or type `lat, lon`), or tap ◎ / Tap to pin.
2. **Walk**: tap Start and walk the property line, then the highs, lows and swales.
   - Tap ◆ Spot shot on a benchmark or a laser-level reading and enter the known elevation. This ties the LiDAR to your datum.
   - Tap 🌳 Tree at each trunk you want to mark.
   - **Keep the screen on.** iPhone stops GPS when the screen locks. The app requests a wake lock to prevent this.
3. When you finish the walk, tap **Build surface**. The app pulls USGS LiDAR elevations on a grid over the site.
4. **Walk tab → Property line** turns a walk into the boundary. Use **Edit corners** on the Site tab to fine-tune it.
5. **Trees**: set DBH, canopy, species, and Remove / Stays for each tree.
6. **Takeoff**: add the lines to price and measure each one on the map (see above).
7. **Estimate**: check the cost sheet, the schedule and the equipment table. Export to Excel or CSV, or build the proposal.
8. **📐 Drawing**: a Letter or 11×17 site plan with property-line bearings and distances, trees, features, contours, and the numbered takeoff items. On 11×17 the takeoff list prints beside the drawing.

## Accuracy notes
- Phone GPS is roughly ±10–30 ft horizontally, and phone altitude is worse. That's why quantities use USGS LiDAR (typically ±0.3 ft where 1 m LiDAR exists). The Site tab shows the source resolution. Enter known spot elevations to correct the datum.
- Bearings and distances come from the GPS walk. **This is not a boundary survey.**
- Shrink, swell, truck size and topsoil factors are on the Site tab. The default prices are placeholders.

## Data
Everything is stored on the phone (Safari local storage). Use Sites → Export to back up a job or move it to another device.
Imagery: Esri World Imagery / USGS. Elevations: USGS 3DEP. Geocoding: Esri, with OpenStreetMap Nominatim as a fallback.
