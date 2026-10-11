# Validation Results

## 3. Results
 - App runs on both ports
 - App runs on local lan in a mobile browser

# 4. Results

## Web
- V1: passes; estimate 105kcal with 1.3g protein, 27g carbs, 0.4 grams of fat
- V2: passes
- V3: tested `campbell's chicken noodle soup`. Original protein value: `3.7`, edited to `3.8`; Thed edited value is saved, no source mentioned (on manual or AI entries)
- V4: passes
- V5: passes; app returned `Couldn't identify food. Try describing something differently, or enter it manually`
- V6: passes; used a picture of a bbq rib plate with corn on the cob an toast. Added in note about a bbq sauce, and a michelob ultra beer (not in picture) - items successfully added. *Note: michelob ultra beer had an app generated note `Calories don't match the protein, carbs and fat. Check the values. This may indicate to you that app generated logic that validates the per/calorie value of a macro totals up to the total calorie amount of the item is working. I accepted values*
- V7: successful
- V8: passes; totals reflect the amount of the deleted and edited protein count
- V9: passes
- V10: passes
- V11: passes; `AI look up is unavailable right now. You can still enter the food manually`
- V12: unknown; no previous totals available to edit. Consider passing for Current-State and add as a follow up for later
- V13: unknonw; followed steps in `quickstart.md`. Did not see any additional info and only a basic description, but known if I did this right. I think it is passing
- V14: passes

## Mobile
Same results as `Web`


# Observations
Below are some observations I've made during my testing:
- suggestion for a future enhancement. Currently, edited entries move to the top of the list when editing with no transition. I found this to be confusing at first, thinking the items had been reordered. A subtle transition to let the user know what is happening.
- Another idea for a future release: I might forget to log entries for one day, but currently see no way to add entries to a previous day. 