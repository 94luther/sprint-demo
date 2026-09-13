# Icons in this folder

The four category icons are from Icons8 (https://icons8.com), Color style, 96 px.

| File | Icons8 slug | Downloaded |
|---|---|---|
| icon_indian.png | curry | 13 Sep 2026 |
| icon_thai.png | noodles | 13 Sep 2026 |
| icon_icecream.png | ice-cream-cone | 13 Sep 2026 |
| icon_deals.png | discount--v1 | 13 Sep 2026 |

**The free Icons8 licence requires a visible credit wherever these appear.** The home screen
carries it in the footer: "Category icons by Icons8". Remove the credit only if Sprint buys a
paid Icons8 licence, and record that purchase here when it happens.

Two slugs in the original brief, `indian-roast` and `kawaii-noodle`, do not exist on Icons8 and
returned 404 with an 84 byte JSON error body. Curl writes that body to the .png file quite
happily, so a download script that does not check the magic bytes ships a broken image that only
fails on a phone. Every file here was checked for the PNG signature after download.

No competitor brand marks are stored in this folder. The brand row uses Sprint's own verified
partner logos in assets/partner_data/Logos.

## Category icons matched to the app's real data, 13 Sep 2026

The first four icons were Indian, Thai, Ice cream and Deals, which came from a generic brief and
match nothing in Sprint's partner data. The real categories, counted from merchants_database.json,
are Restaurants 12, Supermarket 8, Stationery 5, Pharmacy 4 and Liquor 2. These five were added:

| File | Icons8 slug | For |
|---|---|---|
| cat_restaurants.png | restaurant | Restaurants, 12 merchants |
| cat_supermarket.png | grocery-store | Supermarket, 8 |
| cat_stationery.png | stationery | Stationery, 5 |
| cat_pharmacy.png | pharmacy-shop | Pharmacy, 4 |
| cat_liquor.png | wine-bottle | Liquor, 2 |

`liquor`, `wine-bar`, `prescription`, `indian-food`, `thai-food`, `ramen` and `pad-thai` all
return 404 on Icons8. Every slug here was probed before it was used.

The first four icons are kept: icon_deals.png is the orange highlight chip, and the other three
are ready if Sprint ever lists cuisine as well as shop type.
