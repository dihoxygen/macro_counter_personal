import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { estimateFromPhoto, estimateFromText } from './api/estimates.ts';
import { getStatus } from './api/status.ts';
import { ServicesProvider, type Services } from './app/services.tsx';
import { openDb } from './data/db.ts';
import { IdbEntryRepository } from './data/entryRepository.ts';
import { LogService } from './data/logService.ts';
import { IdbProteinGoalRepository } from './data/proteinGoalRepository.ts';
import { IdbSavedFoodRepository } from './data/savedFoodRepository.ts';
import { reencodePhoto } from './media/reencodePhoto.ts';
import './styles.css';

const db = await openDb();
const entries = new IdbEntryRepository(db);
const savedFoods = new IdbSavedFoodRepository(db);
const services: Services = {
  entries,
  savedFoods,
  goals: new IdbProteinGoalRepository(db),
  log: new LogService(entries, savedFoods),
  getStatus,
  estimateFromText,
  estimateFromPhoto,
  reencodePhoto,
  now: () => new Date(),
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesProvider services={services}>
      <App />
    </ServicesProvider>
  </StrictMode>,
);
