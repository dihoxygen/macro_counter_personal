# Validation Results

## 2. Results
 - Coverage report from v8
---------------------------|---------|----------|---------|---------|----------------------------
File                       | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
---------------------------|---------|----------|---------|---------|----------------------------
All files                  |   95.76 |    92.43 |   94.71 |   96.86 |
 src                       |      50 |       80 |      75 |   45.45 |
  App.tsx                  |     100 |       80 |     100 |     100 | 30,32
  main.tsx                 |       0 |      100 |       0 |       0 | 15-30
  styles.css               |       0 |        0 |       0 |       0 |
 src/api                   |   97.82 |       90 |     100 |     100 |
  estimates.ts             |   97.36 |     87.5 |     100 |     100 | 113,124
  status.ts                |     100 |      100 |     100 |     100 |
 src/app                   |   83.33 |       50 |     100 |     100 |
  services.tsx             |   83.33 |       50 |     100 |     100 | 30
 src/data                  |     100 |    97.61 |     100 |     100 |
  db.ts                    |     100 |    66.66 |     100 |     100 | 41
  entryRepository.ts       |     100 |      100 |     100 |     100 |
  logService.ts            |     100 |      100 |     100 |     100 |
  migrations.ts            |     100 |      100 |     100 |     100 |
  proteinGoalRepository.ts |     100 |      100 |     100 |     100 |
  records.ts               |     100 |      100 |     100 |     100 |
  repositories.ts          |       0 |        0 |       0 |       0 |
  savedFoodRepository.ts   |     100 |      100 |     100 |     100 |
 src/domain                |     100 |      100 |     100 |     100 |
  days.ts                  |     100 |      100 |     100 |     100 |
  goals.ts                 |     100 |      100 |     100 |     100 |
  review.ts                |     100 |      100 |     100 |     100 |
  types.ts                 |     100 |      100 |     100 |     100 |
 src/domain/nutrition      |     100 |      100 |     100 |     100 |
  format.ts                |     100 |      100 |     100 |     100 |
  plausibility.ts          |     100 |      100 |     100 |     100 |
  proteinProgress.ts       |     100 |      100 |     100 |     100 |
  scale.ts                 |     100 |      100 |     100 |     100 |
  totals.ts                |     100 |      100 |     100 |     100 |
  validate.ts              |     100 |      100 |     100 |     100 |
 src/features/add-food     |   91.66 |    85.52 |   90.54 |   93.49 |
  AddFood.tsx              |      70 |    58.33 |   55.55 |    87.5 | 46-48
  AddFoodPhoto.tsx         |   96.29 |     87.5 |     100 |   96.29 | 37
  AddFoodText.tsx          |     100 |      100 |     100 |     100 |
  ManualEntryForm.tsx      |     100 |      100 |     100 |     100 |
  ReviewEstimate.tsx       |   89.85 |     90.9 |   91.66 |   88.33 | 62,199-200,232,286-287,306
  useEstimateFlow.ts       |   92.59 |       80 |     100 |   95.65 | 54
 src/features/goal         |   96.87 |    91.66 |     100 |     100 |
  GoalSettings.tsx         |   96.87 |    91.66 |     100 |     100 | 20
 src/features/history      |     100 |      100 |     100 |     100 |
  DayView.tsx              |     100 |      100 |     100 |     100 |
 src/features/recent       |   97.36 |    95.45 |      90 |     100 |
  RecentFoods.tsx          |   97.36 |    95.45 |      90 |     100 | 21
 src/features/shared       |     100 |      100 |     100 |     100 |
  FormBits.tsx             |     100 |      100 |     100 |     100 |
  entryForm.ts             |     100 |      100 |     100 |     100 |
  numberField.ts           |     100 |      100 |     100 |     100 |
 src/features/today        |   97.27 |     91.3 |   93.47 |   97.95 |
  DayLog.tsx               |   95.65 |      100 |   88.88 |      95 | 46
  EntryEditor.tsx          |   96.07 |      100 |   89.47 |   97.77 | 88
  EntryList.tsx            |     100 |       50 |     100 |     100 | 27
  ProteinProgress.tsx      |     100 |      100 |     100 |     100 |
  TodayScreen.tsx          |     100 |      100 |     100 |     100 |
  TotalsPanel.tsx          |     100 |      100 |     100 |     100 |
  useCurrentDayKey.ts      |     100 |       50 |     100 |     100 | 16
 src/media                 |     100 |      100 |     100 |     100 |
  reencodePhoto.ts         |     100 |      100 |     100 |     100 |
---------------------------|---------|----------|---------|---------|----------------------------

## 3. Results
 - App runs on both ports
 - App runs on local lan in a mobile browser

# 4. Results

## Web
- **All Tests with AI/photo coverage *Failed*: App message: `AI is unavailabe at this time. You can still enter in food manually"**
- V7: *Passes*; previous manual entry still exists after reloading page. closing browswer and reopening
- V8: *Passes*; previous manual entry was removed after a warning dialouge asked for confirmation
- V9: *Unknown*; was able to set entry to 180, but unable to change it to 150. manual entry did show 90/180 before deleting in `V8`
- V10: *Passes*; "chicken" was manually entered to 1 serving of 16 protein, 36kcal, 1 carb and 1 grams of fat. Selected from previous entry, changed to 2 entries. Result: `36g of protein, 72kcal, 2g of fat, and 2g of carbs`
- V12: *Fails*; unable to edit previous days entries
- v14: *Passes*; added a manual entry, and clicked `Back` before saving. No entry saved


## Mobile
- ***All Tests with AI/photo coverage *Failed*: App message: `AI is unavailabe at this time. You can still enter in food manually"***
- V3: Cannot tell if protein estimate saves. No confirmation on when clicking `Save`; AI function not working
- V7: *Fails*; does not appear AI or manual adds are functioning
- V8: Cannot test delete since nothing is adding
- V9: *Fails*; unable to add protein goal. 
- V10: *Fails*; unable to add any entry
- V12: *Fails*; unable to add any entry
- V14: *Fails*; unable to add any entry to test


# Observations
Below are some observations I've made during my testing:
- `No Calendar function`: Navigating to previous entries are a slow and manual process of clicking to the corrected date
- Unable to edit a protein goal for a given date.