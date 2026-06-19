import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { gsap } from 'gsap';
import {
  Plus,
  Trash2,
  TrendingUp,
  ShieldAlert,
  Copy,
  Check,
  RefreshCw,
  Users as UsersIcon,
  Send,
  Wifi,
  WifiOff,
  Lock,
  Unlock,
  X,
  ShieldCheck,
  Camera,
  Upload,
  ImageIcon,
  ChevronRight,
  Heart,
  Phone,
  MapPin,
  AlertTriangle,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────
const TREKKERS = ['Noshin', 'Nazih', 'Nihad', 'Jilshad'] as const;
type Trekker = typeof TREKKERS[number];
type User = Trekker | 'Treasurer';

const CATEGORIES = [
  { id: 'Food', label: 'Food', icon: '🍎', dbName: 'Food' },
  { id: 'Travel', label: 'Travel', icon: '🚌', dbName: 'Transport' },
  { id: 'Stay', label: 'Stay', icon: '🏨', dbName: 'Stay' },
  { id: 'Shopping', label: 'Shopping', icon: '🛍️', dbName: 'Gear' },
  { id: 'Misc', label: 'Misc', icon: '⚙️', dbName: 'Other' },
  { id: 'Fixed-Package', label: 'Fixed-Pkg', icon: '📦', dbName: 'Other' },
] as const;

const DEFAULT_BASE_CAMP = {
  name: 'Hampta Pass Base Camp',
  coords: '32.2432° N, 77.2578° E',
  altitude: '4,270 m (14,009 ft)',
  rescue: 'Manali Mountain Rescue: +91 1902 252 605',
  hospital: 'Zonal Hospital Manali: +91 1902 252 118',
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface Expense {
  id: string | number;
  amount: number;
  description: string;
  category: string;
  payer: string;
  split_between: string | string[];
  type: 'expense' | 'Fixed-Package' | 'TOP_UP';
  timestamp: string;
}

interface SafetyMemberInfo {
  blood: string;
  contact: string;
  contactPhone: string;
}

interface EmergencyData {
  trekkers: Record<Trekker, SafetyMemberInfo>;
  baseCamp: typeof DEFAULT_BASE_CAMP;
}

interface TripState {
  id: number;
  group_status: 'Ahead' | 'Behind' | 'Resting' | 'Emergency';
  emergency_data: EmergencyData;
}

interface QueueItem {
  id: string;
  action: 'insert_expense' | 'delete_expense' | 'update_status';
  payload: any;
}

const DEFAULT_BUDGET = 60000;
const TREASURER_PASSCODE = '2026';
const PHOTO_BUCKET = 'trip_photos';
const DEFAULT_EMERGENCY_DATA: EmergencyData = {
  trekkers: {
    Noshin:  { blood: 'B+',  contact: 'Father - Rashid',  contactPhone: '+91 98765 00001' },
    Nazih:   { blood: 'O+',  contact: 'Mother - Fareeda', contactPhone: '+91 98765 00002' },
    Nihad:   { blood: 'A+',  contact: 'Brother - Fahad',  contactPhone: '+91 98765 00003' },
    Jilshad: { blood: 'AB+', contact: 'Sister - Amira',   contactPhone: '+91 98765 00004' },
  },
  baseCamp: DEFAULT_BASE_CAMP,
};

interface TripPhoto {
  name: string;
  url: string;
  isOptimistic?: boolean;
}

// ─── Helper: normalise split list ─────────────────────────────────────────────
const normaliseSplit = (raw: string | string[]): string[] => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
};

const normaliseEmergencyData = (raw: unknown): EmergencyData => {
  const incoming = (raw && typeof raw === 'object' ? raw : {}) as Partial<EmergencyData>;
  const incomingTrekkers = (incoming.trekkers && typeof incoming.trekkers === 'object' ? incoming.trekkers : {}) as Partial<Record<Trekker, Partial<SafetyMemberInfo>>>;

  return {
    baseCamp: { ...DEFAULT_EMERGENCY_DATA.baseCamp, ...(incoming.baseCamp ?? {}) },
    trekkers: TREKKERS.reduce((acc, name) => ({
      ...acc,
      [name]: { ...DEFAULT_EMERGENCY_DATA.trekkers[name], ...(incomingTrekkers[name] ?? {}) },
    }), {} as Record<Trekker, SafetyMemberInfo>),
  };
};

// ─── Helper: category display meta ───────────────────────────────────────────
const getCategoryMeta = (catName: string) => {
  switch (catName) {
    case 'Food':      return { icon: '🍎', color: 'bg-amber-100 text-amber-800' };
    case 'Transport': return { icon: '🚌', color: 'bg-sky-100 text-sky-800' };
    case 'Stay':      return { icon: '🏨', color: 'bg-indigo-100 text-indigo-800' };
    case 'Gear':      return { icon: '🛍️', color: 'bg-emerald-100 text-emerald-800' };
    default:          return { icon: '⚙️', color: 'bg-slate-100 text-slate-800' };
  }
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function TripTracker() {
  // — Connection
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // — Core data
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [tripState, setTripState] = useState<TripState>({ id: 1, group_status: 'Ahead', emergency_data: DEFAULT_EMERGENCY_DATA });

  // — Role / Auth
  const [isTreasurerUnlocked, setIsTreasurerUnlocked] = useState(
    () => localStorage.getItem('treasurer_unlocked') === 'true'
  );
  const [currentUser, setCurrentUser] = useState<User>('Noshin');
  const [passcode, setPasscode] = useState('');
  const [showPasscodeInput, setShowPasscodeInput] = useState(false);
  const [passcodeError, setPasscodeError] = useState(false);

  // — Sync
  const [pendingQueue, setPendingQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // — Expense form
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<typeof CATEGORIES[number]['id']>('Food');
  const [payer, setPayer] = useState<User>('Noshin');
  const [splitBetween, setSplitBetween] = useState<User[]>([...TREKKERS]);
  const [expenseType, setExpenseType] = useState<'expense' | 'Fixed-Package'>('expense');

  // — Backup token
  const [tokenInput, setTokenInput] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  // — Personal Dashboard overlay
  const [activeTrekker, setActiveTrekker] = useState<Trekker | null>(null);
  const personalOverlayRef = useRef<HTMLDivElement>(null);

  // — Safety Panel
  const [showSafety, setShowSafety] = useState(false);
  const [isEditingSafety, setIsEditingSafety] = useState(false);
  const [safetyDraft, setSafetyDraft] = useState<EmergencyData>(DEFAULT_EMERGENCY_DATA);
  const [savingSafety, setSavingSafety] = useState(false);
  const safetyPanelRef = useRef<HTMLDivElement>(null);

  // — Memory Vault
  const [photos, setPhotos] = useState<TripPhoto[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);

  // — GSAP refs
  const trafficLightRef = useRef<HTMLDivElement>(null);
  const pulseTweenRef = useRef<gsap.core.Tween | null>(null);
  const categoryGridRef = useRef<HTMLDivElement>(null);

  // ── Derived
  const availableUsers = isTreasurerUnlocked ? [...TREKKERS, 'Treasurer' as const] : TREKKERS;

  // Payment / expense UI state
  const [paymentType, setPaymentType] = useState<'single' | 'multiple'>('single');
  const [contributions, setContributions] = useState<Record<Trekker, number>>({ Noshin: 0, Nazih: 0, Nihad: 0, Jilshad: 0 });
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cash'>('online');
  // Treasurer mode toggle (must be true + role === 'Treasurer' to show logger)
  const [isTreasurerMode, setIsTreasurerMode] = useState<boolean>(false);
  // Top-up mode for Treasurer logger
  const [isTopUpMode, setIsTopUpMode] = useState<boolean>(false);

  // Emergency buffer and leg allocations
  const [emergencyBuffer] = useState<number>(4000);
  const legAllocation = { manali: 0.7, delhi: 0.3 } as const; // 70/30 split by default

  const totalStandardSpend = expenses.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const totalFixedSpend    = expenses.filter((e) => e.type === 'Fixed-Package').reduce((s, e) => s + e.amount, 0);
  const totalGroupSpend    = totalStandardSpend + totalFixedSpend;
  const remainingBudget    = DEFAULT_BUDGET - totalGroupSpend;
  const spendPercentage    = (totalGroupSpend / DEFAULT_BUDGET) * 100;

  let trafficStatus: 'green' | 'yellow' | 'red' = 'green';
  if (spendPercentage >= 90) trafficStatus = 'red';
  else if (spendPercentage >= 70) trafficStatus = 'yellow';

  // Build per-trekker paid/share/balance using optional per-expense contributions
  const individualCalculations = TREKKERS.map((name) => {
    // Paid: prefer explicit contributions map on expense; otherwise fall back to payer owning full amount
    const paid = expenses
      // include TOP_UP and expense in paid calculations
      .filter((e) => e.type === 'expense' || e.type === 'TOP_UP')
      .reduce((s, e) => {
        // If contributions field exists and has an entry for this name, use that contribution
        if ((e as any).contributions && (e as any).contributions[name] != null) {
          return s + Number((e as any).contributions[name] || 0);
        }
        // Fallback: if payer matches name, they paid the full amount
        if (e.payer === name) return s + e.amount;
        return s;
      }, 0);

    // Share: calculate how much of each expense this person is responsible for (exclude TOP_UP)
    let share = 0;
    expenses.forEach((e) => {
      if (e.type === 'expense') {
        const splits = normaliseSplit(e.split_between);
        if (splits.includes(name)) share += e.amount / splits.length;
      }
    });

    return { name, paid, share, balance: paid - share };
  });

  // Calculate top-up totals per trekker and personal ceilings
  const topUpTotals: Record<Trekker, number> = TREKKERS.reduce((acc, t) => ({ ...acc, [t]: 0 }), {} as Record<Trekker, number>);
  expenses.forEach((e) => {
    if (e.type === 'TOP_UP') {
      // if contributions map exists, use it, otherwise attribute to payer
      if ((e as any).contributions) {
        Object.entries((e as any).contributions).forEach(([k, v]) => {
          if (TREKKERS.includes(k as Trekker)) topUpTotals[k as Trekker] = (topUpTotals[k as Trekker] || 0) + Number(v || 0);
        });
      } else if (TREKKERS.includes(e.payer as Trekker)) {
        topUpTotals[e.payer as Trekker] = (topUpTotals[e.payer as Trekker] || 0) + Number(e.amount || 0);
      }
    }
  });

  const personalCeiling = TREKKERS.reduce((acc, t) => ({ ...acc, [t]: 15000 + (topUpTotals[t] || 0) }), {} as Record<Trekker, number>);

  // Leg spends and percentages
  const manaliSpend = expenses.filter(e => ['Transport', 'Stay', 'Other'].includes(e.category)).reduce((s,e) => s + e.amount, 0);
  const delhiSpend  = expenses.filter(e => ['Food', 'Gear', 'Other'].includes(e.category)).reduce((s,e) => s + e.amount, 0);
  const manaliPct = Math.min(100, Math.round((manaliSpend / (DEFAULT_BUDGET * legAllocation.manali || 1)) * 100));
  const delhiPct  = Math.min(100, Math.round((delhiSpend  / (DEFAULT_BUDGET * legAllocation.delhi  || 1)) * 100));

  const getPersonalExpenses = useCallback((trekkerName: string): Expense[] =>
    expenses.filter((e) => {
      if (e.type === 'Fixed-Package') return false;
      const splits = normaliseSplit(e.split_between);
      return e.payer === trekkerName || splits.includes(trekkerName);
    }), [expenses]);
  const safetyData = isEditingSafety ? safetyDraft : tripState.emergency_data;

  // ── Network listeners
  useEffect(() => {
    const queue = localStorage.getItem('pending_sync_queue');
    if (queue) {
      try { setPendingQueue(JSON.parse(queue)); } catch (_) {}
    }
    const handleOnline  = () => { setIsOnline(true); flushQueue(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Fetch data
  const fetchData = useCallback(async () => {
    try {
      setSyncing(true);
      const [{ data: expData, error: expErr }, { data: stateData, error: stateErr }] = await Promise.all([
        supabase.from('expenses').select('*').order('timestamp', { ascending: false }),
        supabase.from('trip_state').select('*'),
      ]);
      if (expErr) throw expErr;
      if (stateErr) throw stateErr;

      let merged: Expense[] = (expData ?? []).map((e) => ({ ...e, amount: parseFloat(e.amount) }));

      const queueStr = localStorage.getItem('pending_sync_queue');
      let q: QueueItem[] = [];
      if (queueStr) { try { q = JSON.parse(queueStr); } catch (_) {} }
      q.forEach((item) => {
        if (item.action === 'insert_expense') merged = [item.payload, ...merged];
        else if (item.action === 'delete_expense') merged = merged.filter((e) => e.id !== item.payload.id);
      });
      setExpenses(merged);

      if (stateData && stateData.length > 0) {
        let s: TripState = {
          ...stateData[0],
          emergency_data: normaliseEmergencyData(stateData[0].emergency_data),
        };
        q.forEach((item) => {
          if (item.action === 'update_status') s = { ...s, group_status: item.payload.group_status };
        });
        setTripState(s);
      } else {
        const def = { id: 1, group_status: 'Ahead' as const, emergency_data: DEFAULT_EMERGENCY_DATA };
        await supabase.from('trip_state').insert([def]);
        setTripState(def);
      }
      setErrorMessage(null);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Failed to sync');
      loadOfflineFallback();
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  const loadOfflineFallback = () => {
    const savedExp   = localStorage.getItem('offline_expenses_cache');
    const savedState = localStorage.getItem('offline_state_cache');
    if (savedExp)   { try { setExpenses(JSON.parse(savedExp)); }   catch (_) {} }
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        setTripState({ ...parsed, emergency_data: normaliseEmergencyData(parsed.emergency_data) });
      } catch (_) {}
    }
  };

  useEffect(() => {
    if (expenses.length > 0) localStorage.setItem('offline_expenses_cache', JSON.stringify(expenses));
    localStorage.setItem('offline_state_cache', JSON.stringify(tripState));
  }, [expenses, tripState]);

  useEffect(() => {
    if (!isEditingSafety) setSafetyDraft(tripState.emergency_data);
  }, [isEditingSafety, tripState.emergency_data]);

  useEffect(() => {
    fetchData();
    const ch1 = supabase.channel('rt:expenses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => {
        if (navigator.onLine && !localStorage.getItem('pending_sync_queue')) fetchData();
      }).subscribe();
    const ch2 = supabase.channel('rt:trip_state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_state' }, () => {
        if (navigator.onLine && !localStorage.getItem('pending_sync_queue')) fetchData();
      }).subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  }, [fetchData]);

  const ensurePhotoBucket = useCallback(async () => {
    try {
      const { data, error } = await supabase.storage.getBucket(PHOTO_BUCKET);
      if (data || !error) return;

      const bucketMissing = /not found|does not exist/i.test(error.message);
      if (!bucketMissing) {
        console.warn('Photo bucket check failed:', error.message);
        return;
      }

      const { error: createError } = await supabase.storage.createBucket(PHOTO_BUCKET, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      });

      if (createError && !/already exists/i.test(createError.message)) {
        console.warn('Photo bucket creation failed:', createError.message);
      }
    } catch (err) {
      console.warn('Photo bucket setup skipped:', err);
    }
  }, []);

  // ── Fetch photos
  const fetchPhotos = useCallback(async () => {
    try {
      await ensurePhotoBucket();
      const { data, error } = await supabase.storage.from(PHOTO_BUCKET).list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
      if (error) throw error;
      const urls = (data ?? [])
        .filter((f) => f.name !== '.emptyFolderPlaceholder')
        .map((f) => ({
          name: f.name,
          url: supabase.storage.from(PHOTO_BUCKET).getPublicUrl(f.name).data.publicUrl,
        }));
      setPhotos(urls);
    } catch (err) {
      console.error('Photo fetch error:', err);
    }
  }, [ensurePhotoBucket]);

  useEffect(() => { fetchPhotos(); }, [fetchPhotos]);

  // ── User switch side-effects
  useEffect(() => {
    if (currentUser !== 'Treasurer') {
      setExpenseType('expense');
      if (selectedCategory === 'Fixed-Package') setSelectedCategory('Food');
    }
    setPayer(currentUser);
  }, [currentUser]);

  // ── GSAP: Traffic light
  useEffect(() => {
    if (pulseTweenRef.current) pulseTweenRef.current.kill();
    const lightClass = `.${trafficStatus}-light-glow`;
    const target = trafficLightRef.current?.querySelector(lightClass);
    if (target) {
      pulseTweenRef.current = gsap.to(target, { opacity: 0.8, scale: 1.35, duration: 0.8, repeat: -1, yoyo: true, ease: 'power1.inOut' });
    }
    gsap.fromTo(trafficLightRef.current, { scale: 0.95, opacity: 0.85 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.5)' });
    return () => { if (pulseTweenRef.current) pulseTweenRef.current.kill(); };
  }, [trafficStatus]);

  // ── GSAP: Personal Dashboard slide-in
  const openPersonalDashboard = (name: Trekker) => {
    setActiveTrekker(name);
    requestAnimationFrame(() => {
      if (personalOverlayRef.current) {
        gsap.fromTo(personalOverlayRef.current,
          { opacity: 0, x: 60 },
          { opacity: 1, x: 0, duration: 0.4, ease: 'power3.out' }
        );
      }
    });
  };

  const closePersonalDashboard = () => {
    if (personalOverlayRef.current) {
      gsap.to(personalOverlayRef.current, {
        opacity: 0, x: 60, duration: 0.3, ease: 'power3.in',
        onComplete: () => setActiveTrekker(null),
      });
    } else {
      setActiveTrekker(null);
    }
  };

  // ── GSAP: Safety Panel fade-in
  const openSafetyPanel = () => {
    setSafetyDraft(tripState.emergency_data);
    setShowSafety(true);
    requestAnimationFrame(() => {
      if (safetyPanelRef.current) {
        gsap.fromTo(safetyPanelRef.current,
          { opacity: 0, scale: 0.97 },
          { opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out' }
        );
      }
    });
  };

  const closeSafetyPanel = () => {
    if (safetyPanelRef.current) {
      gsap.to(safetyPanelRef.current, {
        opacity: 0, scale: 0.97, duration: 0.25, ease: 'power3.in',
        onComplete: () => {
          setIsEditingSafety(false);
          setShowSafety(false);
        },
      });
    } else {
      setIsEditingSafety(false);
      setShowSafety(false);
    }
  };

  // ── GSAP: Lightbox
  const openLightbox = (url: string) => {
    setLightboxPhoto(url);
    requestAnimationFrame(() => {
      if (lightboxRef.current) {
        gsap.fromTo(lightboxRef.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' });
      }
    });
  };

  const closeLightbox = () => {
    if (lightboxRef.current) {
      gsap.to(lightboxRef.current, { opacity: 0, duration: 0.2, ease: 'power2.in', onComplete: () => setLightboxPhoto(null) });
    } else {
      setLightboxPhoto(null);
    }
  };

  // ── Sync queue
  const flushQueue = async () => {
    const queueStr = localStorage.getItem('pending_sync_queue');
    if (!queueStr) return;
    let queue: QueueItem[] = [];
    try { queue = JSON.parse(queueStr); } catch (_) { return; }
    if (!queue.length) return;

    setSyncing(true);
    const remaining = [...queue];
    try {
      for (const item of queue) {
        if (item.action === 'insert_expense') {
          const { id, ...payload } = item.payload;
          const { error } = await supabase.from('expenses').insert([payload]);
          if (error) throw error;
        } else if (item.action === 'delete_expense') {
          const { error } = await supabase.from('expenses').delete().eq('id', item.payload.id);
          if (error) throw error;
        } else if (item.action === 'update_status') {
          const { error } = await supabase.from('trip_state').update({ group_status: item.payload.group_status }).eq('id', tripState.id);
          if (error) throw error;
        }
        remaining.shift();
      }
      localStorage.removeItem('pending_sync_queue');
      setPendingQueue([]);
      fetchData();
    } catch (err: any) {
      localStorage.setItem('pending_sync_queue', JSON.stringify(remaining));
      setPendingQueue(remaining);
    } finally {
      setSyncing(false);
    }
  };

  const addToQueue = (action: QueueItem['action'], payload: any) => {
    const item: QueueItem = { id: Math.random().toString(36).substring(7), action, payload };
    const updated = [...pendingQueue, item];
    setPendingQueue(updated);
    localStorage.setItem('pending_sync_queue', JSON.stringify(updated));
    if (action === 'insert_expense') setExpenses((prev) => [payload, ...prev]);
    else if (action === 'delete_expense') setExpenses((prev) => prev.filter((e) => e.id !== payload.id));
    else if (action === 'update_status') setTripState((prev) => ({ ...prev, group_status: payload.group_status }));
  };

  // ── Auth
  const handleUnlockTreasurer = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode === TREASURER_PASSCODE) {
      setIsTreasurerUnlocked(true);
      localStorage.setItem('treasurer_unlocked', 'true');
      setCurrentUser('Treasurer');
      setShowPasscodeInput(false);
      setPasscode('');
      setPasscodeError(false);
    } else {
      setPasscodeError(true);
      setPasscode('');
    }
  };

  const handleLockTreasurer = () => {
    setIsTreasurerUnlocked(false);
    localStorage.removeItem('treasurer_unlocked');
    setCurrentUser('Noshin');
  };

  // ── Category selection
  const handleCategorySelect = (catId: typeof CATEGORIES[number]['id']) => {
    if (catId === 'Fixed-Package' && currentUser !== 'Treasurer') return;
    setSelectedCategory(catId);
    setExpenseType(catId === 'Fixed-Package' ? 'Fixed-Package' : 'expense');
    const el = categoryGridRef.current?.querySelector(`[data-cat="${catId}"]`);
    if (el) gsap.fromTo(el, { scale: 0.93 }, { scale: 1, duration: 0.25, ease: 'back.out(2)' });
  };

  // ── Split helpers
  const allTrekkersSelected = TREKKERS.every((t) => splitBetween.includes(t));
  const handleToggleSelectAllSplits = () => setSplitBetween(allTrekkersSelected ? [] : [...TREKKERS]);
  const toggleSplitParticipant = (name: User) =>
    setSplitBetween((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);

  // ── Add expense
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) { alert('Please enter a valid amount'); return; }
    if (!description.trim()) { alert('Please enter a description'); return; }
    if (expenseType !== 'Fixed-Package' && splitBetween.length === 0) { alert('Please select at least one person to split with'); return; }

    const catObj = CATEGORIES.find((c) => c.id === selectedCategory);
    const newExpense: any = {
      id: Math.random().toString(36).substring(7),
      amount: parseFloat(amount),
      description: description.trim(),
      category: catObj ? catObj.dbName : 'Other',
      payer,
      split_between: expenseType === 'Fixed-Package' ? [] : splitBetween,
      type: expenseType,
      payment_type: paymentType,
      payment_method: paymentMethod,
      timestamp: new Date().toISOString(),
    };

    if (paymentType === 'multiple') {
      newExpense.contributions = { ...contributions };
      const sum = Object.values(newExpense.contributions).reduce((s: number, v: any) => s + Number(v || 0), 0);
      const sumNum = Number(sum || 0);
      const amtNum = Number(newExpense.amount || 0);
      if (Math.round(sumNum) !== Math.round(amtNum)) {
        if (!confirm(`Contributions total ₹${sumNum} does not equal amount ₹${amtNum}. Proceed?`)) return;
      }
    }

    if (!isOnline) { addToQueue('insert_expense', newExpense); setAmount(''); setDescription(''); return; }

    setSyncing(true);
    try {
  const { id, ...dbPayload } = newExpense;
  const { error } = await supabase.from('expenses').insert([dbPayload]);
      if (error) throw error;
  setAmount(''); setDescription('');
  // Reset payment UI
  setContributions({ Noshin: 0, Nazih: 0, Nihad: 0, Jilshad: 0 });
  setPaymentType('single'); setPaymentMethod('online'); setPayer('Noshin');
    } catch (err) {
      addToQueue('insert_expense', newExpense);
      setAmount(''); setDescription('');
    } finally {
      setSyncing(false);
    }
  };

  // Handle personal top-ups (stored as type: 'TOP_UP')
  const [topUpTrekker, setTopUpTrekker] = useState<Trekker>('Noshin');
  const [topUpAmount, setTopUpAmount] = useState('');

  const handleAddTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(topUpAmount);
    if (!amt || amt <= 0) { alert('Enter a valid top-up amount'); return; }
    const newTopUp: any = {
      id: Math.random().toString(36).substring(7),
      amount: amt,
      description: 'Personal Top-Up',
      category: 'Other',
      payer: topUpTrekker,
      split_between: [],
      type: 'TOP_UP',
      timestamp: new Date().toISOString(),
    };
    if (!isOnline) { addToQueue('insert_expense', newTopUp); setTopUpAmount(''); return; }
    setSyncing(true);
    try {
      const { id, ...dbPayload } = newTopUp;
      const { error } = await supabase.from('expenses').insert([dbPayload]);
      if (error) throw error;
      setTopUpAmount(''); setIsTopUpMode(false);
    } catch (err: any) {
      addToQueue('insert_expense', newTopUp);
      setTopUpAmount(''); setIsTopUpMode(false);
    } finally { setSyncing(false); }
  };

  // ── Delete expense
  const handleDeleteExpense = async (id: string | number) => {
    if (!confirm('Delete this expense?')) return;
    if (!isOnline) { addToQueue('delete_expense', { id }); return; }
    setSyncing(true);
    try {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      addToQueue('delete_expense', { id });
    } finally {
      setSyncing(false);
    }
  };

  // ── Status beacon
  const updateStatus = async (status: TripState['group_status']) => {
    if (!isOnline) { addToQueue('update_status', { group_status: status }); return; }
    setSyncing(true);
    try {
      const { error } = await supabase.from('trip_state').update({ group_status: status }).eq('id', tripState.id);
      if (error) throw error;
      setTripState((prev) => ({ ...prev, group_status: status }));
    } catch (err) {
      addToQueue('update_status', { group_status: status });
    } finally {
      setSyncing(false);
    }
  };

  // ── Photo upload
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    const ext  = file.name.split('.').pop() || 'jpg';
    const path = `photo_${Date.now()}.${ext}`;
    const localUrl = URL.createObjectURL(file);
    const optimisticPhoto: TripPhoto = { name: path, url: localUrl, isOptimistic: true };
    setPhotos((prev) => [optimisticPhoto, ...prev]);
    try {
      await ensurePhotoBucket();
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { upsert: true });
      if (error) throw error;
      await fetchPhotos();
    } catch (err: any) {
      setPhotos((prev) => prev.filter((photo) => photo.name !== path));
      alert('Upload failed: ' + err.message);
    } finally {
      URL.revokeObjectURL(localUrl);
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleDeletePhoto = async (photo: TripPhoto) => {
    if (currentUser !== 'Treasurer') return;
    if (!confirm('Delete this photo?')) return;

    const previousPhotos = photos;
    setPhotos((prev) => prev.filter((item) => item.name !== photo.name));
    try {
      const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([photo.name]);
      if (error) throw error;
    } catch (err: any) {
      setPhotos(previousPhotos);
      alert('Delete failed: ' + err.message);
    }
  };

  const updateSafetyMember = (name: Trekker, field: keyof SafetyMemberInfo, value: string) => {
    setSafetyDraft((prev) => ({
      ...prev,
      trekkers: {
        ...prev.trekkers,
        [name]: { ...prev.trekkers[name], [field]: value },
      },
    }));
  };

  const updateBaseCamp = (field: keyof EmergencyData['baseCamp'], value: string) => {
    setSafetyDraft((prev) => ({
      ...prev,
      baseCamp: { ...prev.baseCamp, [field]: value },
    }));
  };

  const handleSaveSafety = async () => {
    if (currentUser !== 'Treasurer') return;
    setSavingSafety(true);
    try {
      const { error } = await supabase
        .from('trip_state')
        .update({ emergency_data: safetyDraft })
        .eq('id', 1);
      if (error) throw error;
      setTripState((prev) => ({ ...prev, emergency_data: safetyDraft }));
      setIsEditingSafety(false);
    } catch (err: any) {
      alert('Safety update failed: ' + err.message);
    } finally {
      setSavingSafety(false);
    }
  };

  // ── Sync token
  const generateSyncToken = () => {
    try {
      const token = btoa(unescape(encodeURIComponent(JSON.stringify({ expenses, tripState }))));
      navigator.clipboard.writeText(token);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (_) { alert('Failed to generate token'); }
  };

  const handleRestoreFromToken = async () => {
    if (!tokenInput.trim()) return;
    if (!confirm('This will wipe the current database and replace it with the token data. Proceed?')) return;
    try {
      setSyncing(true);
      const parsed = JSON.parse(decodeURIComponent(escape(atob(tokenInput.trim()))));
      if (!parsed.expenses || !parsed.tripState) throw new Error('Invalid token');
      await supabase.from('expenses').delete().neq('amount', -1);
      if (parsed.expenses.length > 0) {
        const clean = parsed.expenses.map(({ id, ...rest }: any) => rest);
        await supabase.from('expenses').insert(clean);
      }
      await supabase.from('trip_state')
        .update({ group_status: parsed.tripState.group_status })
        .eq('id', tripState.id);
      setRestoreSuccess(true);
      setTokenInput('');
      fetchData();
      setTimeout(() => setRestoreSuccess(false), 2000);
    } catch (err: any) {
      alert('Restore failed: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  // ── WhatsApp export
  const getWhatsAppExport = () => {
    let text = `🏔 *HAMPTA PASS TRIP LEDGER* 🏔\n🚦 Burn Rate: *${spendPercentage.toFixed(1)}%*\n📈 Status: *${tripState.group_status.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━\n\n👤 *BALANCES*:\n`;
    individualCalculations.forEach((i) => {
      const sign = i.balance >= 0 ? '🟢 Owed: +' : '🔴 Owes: ';
      text += `• *${i.name}*: Paid ₹${i.paid.toLocaleString()} | Share: ₹${Math.round(i.share).toLocaleString()} | ${sign}₹${Math.round(Math.abs(i.balance)).toLocaleString()}\n`;
    });
    return encodeURIComponent(text);
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + d.toLocaleDateString();
    } catch (_) { return ''; }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center py-6 px-4 md:px-8">

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header className="w-full max-w-5xl mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
        <div>
          <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Hampta Pass Trek 2026</span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">Trip Planner &amp; Tracker</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Connection badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${
            isOnline && pendingQueue.length === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : !isOnline ? 'bg-rose-50 border-rose-200 text-rose-700'
            : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            {isOnline && pendingQueue.length === 0 ? <><Wifi size={13} /><span>Live</span></>
              : !isOnline ? <><WifiOff size={13} /><span>Offline {pendingQueue.length > 0 && `(${pendingQueue.length})`}</span></>
              : <><RefreshCw size={13} className="animate-spin" /><span>Syncing…</span></>}
          </div>

          {/* Safety button */}
          <button
            id="safety-btn"
            onClick={openSafetyPanel}
            className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
          >
            <ShieldCheck size={13} /> Safety
          </button>

          {/* Treasurer lock/unlock */}
          {isTreasurerUnlocked ? (
            <button
              onClick={handleLockTreasurer}
              className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-all px-3 py-1.5 rounded-xl text-xs font-semibold"
            >
              <Lock size={12} /> Lock
            </button>
          ) : (
            <button
              onClick={() => { setShowPasscodeInput(!showPasscodeInput); setPasscodeError(false); }}
              className="flex items-center gap-1.5 bg-slate-800 text-white hover:bg-slate-900 transition-all px-3 py-1.5 rounded-xl text-xs font-semibold"
            >
              <Unlock size={12} /> Treasurer
            </button>
          )}

          {/* Treasurer Mode Toggle (only meaningful when role is Treasurer) */}
          {currentUser === 'Treasurer' && (
            <button
              onClick={() => setIsTreasurerMode((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${isTreasurerMode ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
              <ShieldCheck size={12} /> {isTreasurerMode ? 'Treasurer Mode' : 'View Mode'}
            </button>
          )}

          {/* Force sync */}
          <button
            onClick={flushQueue}
            disabled={syncing || !isOnline}
            className={`p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none ${syncing ? 'animate-spin' : ''}`}
            title="Flush pending sync"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {/* ── PASSCODE PANEL ──────────────────────────────────────────────────── */}
      {showPasscodeInput && (
        <div className="w-full max-w-5xl mb-6 p-5 bg-white border border-slate-200 shadow-sm rounded-2xl">
          <form onSubmit={handleUnlockTreasurer} className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-bold text-slate-800">Unlock Treasurer Profile</h4>
              <p className="text-xs text-slate-400 mt-0.5">Enter the 4-digit security code.</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <input
                type="password" required placeholder="••••" maxLength={4}
                value={passcode}
                onChange={(e) => { setPasscode(e.target.value); setPasscodeError(false); }}
                className={`w-full sm:w-28 text-center bg-slate-50 border rounded-xl py-2 px-3 text-slate-800 placeholder-slate-400 focus:outline-none text-sm font-bold tracking-widest ${passcodeError ? 'border-rose-400' : 'border-slate-200'}`}
              />
              <button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all shrink-0">
                Verify
              </button>
            </div>
          </form>
          {passcodeError && <p className="text-xs text-rose-600 font-medium mt-2">Incorrect security code.</p>}
        </div>
      )}

      {/* ── ERROR BANNER ────────────────────────────────────────────────────── */}
      {errorMessage && (
        <div className="w-full max-w-5xl mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-3">
          <ShieldAlert className="shrink-0" size={18} />
          <p className="text-sm font-medium">{errorMessage} — using local cache.</p>
        </div>
      )}

      {/* ── DASHBOARD GRID ──────────────────────────────────────────────────── */}
      <main className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">

        {/* LEFT: Burn Rate + Status Beacon */}
        <div className="space-y-6 md:col-span-1">

          {/* Burn Rate */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-150">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Spend Burn Rate</h3>
              <div ref={trafficLightRef} className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
                {(['green', 'yellow', 'red'] as const).map((c) => (
                  <div key={c} className="relative flex h-3 w-3">
                    {trafficStatus === c && (
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${c}-light-glow ${c === 'green' ? 'bg-emerald-400' : c === 'yellow' ? 'bg-amber-400' : 'bg-rose-400'}`} />
                    )}
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${trafficStatus === c ? (c === 'green' ? 'bg-emerald-500 shadow-emerald-500/50 shadow-md' : c === 'yellow' ? 'bg-amber-500 shadow-amber-500/50 shadow-md' : 'bg-rose-500 shadow-rose-500/50 shadow-md') : 'bg-slate-300'}`} />
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-400 uppercase mb-1">
                  <span>Total Budget Used</span><span>{spendPercentage.toFixed(1)}%</span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${trafficStatus === 'green' ? 'bg-emerald-500' : trafficStatus === 'yellow' ? 'bg-amber-500' : 'bg-rose-500'}`}
                    style={{ width: `${Math.min(100, spendPercentage)}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Spent</span>
                  <p className="text-lg font-bold text-slate-800">₹{totalGroupSpend.toLocaleString()}</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Remaining</span>
                  <p className="text-lg font-bold text-slate-800">₹{remainingBudget.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Status Beacon */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-150">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-800">Group Status Beacon</h3>
              {currentUser !== 'Treasurer' && (
                <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider flex items-center gap-1">
                  <Lock size={9} /> Read-only
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mb-4">
              {currentUser === 'Treasurer' ? 'Set team coordination status for all devices.' : 'Live status — Treasurer only can update.'}
            </p>

            {currentUser === 'Treasurer' ? (
              <div className="grid grid-cols-2 gap-2">
                {([['Ahead', '🏃‍♂️', 'emerald'], ['Behind', '🐢', 'amber'], ['Resting', '💤', 'sky'], ['Emergency', '🚨', 'rose']] as const).map(([s, icon, col]) => (
                  <button key={s} onClick={() => updateStatus(s as TripState['group_status'])}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${tripState.group_status === s ? `bg-${col}-50 border-${col}-500 text-${col}-700 shadow-sm` : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {icon} {s}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(['Ahead', 'Behind', 'Resting', 'Emergency'] as const).map((s) => {
                  const meta: Record<string, { icon: string; cls: string }> = {
                    Ahead: { icon: '🏃‍♂️', cls: 'bg-emerald-50 border-emerald-400 text-emerald-700' },
                    Behind: { icon: '🐢', cls: 'bg-amber-50 border-amber-400 text-amber-700' },
                    Resting: { icon: '💤', cls: 'bg-sky-50 border-sky-400 text-sky-700' },
                    Emergency: { icon: '🚨', cls: 'bg-rose-50 border-rose-400 text-rose-700 animate-pulse' },
                  };
                  const isActive = tripState.group_status === s;
                  return (
                    <div key={s} className={`py-2 px-3 rounded-xl border text-xs font-semibold select-none ${isActive ? meta[s].cls : 'bg-white border-slate-100 text-slate-300'}`}>
                      {meta[s].icon} {s}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 text-xs">
              <span className="text-slate-400">Current status:</span>
              <span className={`font-bold uppercase tracking-wider ${tripState.group_status === 'Ahead' ? 'text-emerald-600' : tripState.group_status === 'Behind' ? 'text-amber-600' : tripState.group_status === 'Resting' ? 'text-sky-600' : 'text-rose-600'}`}>
                {tripState.group_status}
              </span>
            </div>
          </div>
        </div>

        {/* MIDDLE: Expense Logger (Treasurer only) */}
  {currentUser === 'Treasurer' && isTreasurerMode && (
          <div className="space-y-6 md:col-span-1">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-150">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="text-indigo-600" size={20} />
                <h3 className="font-semibold text-slate-800">Log Expense</h3>
              </div>

              {/* Tabs: Expense vs Top-Up */}
              <div className="flex items-center gap-2 mb-4">
                <button type="button" onClick={() => setIsTopUpMode(false)} className={`px-3 py-1 rounded-full text-sm font-semibold ${!isTopUpMode ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Log Expense</button>
                <button type="button" onClick={() => setIsTopUpMode(true)} className={`px-3 py-1 rounded-full text-sm font-semibold ${isTopUpMode ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Add Personal Top-Up</button>
              </div>

              {!isTopUpMode ? (
                <form onSubmit={handleAddExpense} className="space-y-4">
              {/* Category Grid */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Category</label>
                <div ref={categoryGridRef} className="grid grid-cols-3 gap-2">
                  {CATEGORIES.map((cat) => {
                    const isSelected  = selectedCategory === cat.id;
                    const isDisabled  = cat.id === 'Fixed-Package' && currentUser !== 'Treasurer';
                    return (
                      <button
                        type="button" key={cat.id} data-cat={cat.id}
                        disabled={isDisabled}
                        onClick={() => handleCategorySelect(cat.id)}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                          isDisabled ? 'bg-slate-50 border-slate-150 text-slate-300 cursor-not-allowed opacity-40'
                          : isSelected ? 'bg-slate-900 border-slate-900 text-white shadow-sm scale-[1.02]'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <span className="text-2xl mb-1">{cat.icon}</span>
                        <span className="text-[10px] font-semibold tracking-tight truncate max-w-full">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Amount (₹)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-slate-400 text-sm">₹</span>
                  </div>
                  <input type="number" required placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-4 py-2.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 text-sm" />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Description</label>
                <input type="text" required placeholder="What was this for?" value={description} onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 text-sm" />
              </div>

              {/* Paid By */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Paid By</label>
                <select value={payer} onChange={(e) => setPayer(e.target.value as User)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-300 text-sm cursor-pointer">
                  {availableUsers.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

              {/* Payment Type: Single / Multiple */}
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Payment Type</label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPaymentType('single')}
                    className={`px-3 py-1 rounded-full text-sm font-semibold ${paymentType === 'single' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
                    Single Payer
                  </button>
                  <button type="button" onClick={() => setPaymentType('multiple')}
                    className={`px-3 py-1 rounded-full text-sm font-semibold ${paymentType === 'multiple' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
                    Multiple Payers
                  </button>
                </div>
              </div>

              {/* Payment Method */}
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Payment Method</label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPaymentMethod('online')} className={`px-3 py-1 rounded-full text-sm font-semibold ${paymentMethod === 'online' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
                    Online Pay 💳
                  </button>
                  <button type="button" onClick={() => setPaymentMethod('cash')} className={`px-3 py-1 rounded-full text-sm font-semibold ${paymentMethod === 'cash' ? 'bg-amber-500 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
                    Cash 💵
                  </button>
                </div>
              </div>

              {/* Multiple Payers: contributions inputs */}
              {paymentType === 'multiple' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Contributions</label>
                  <div className="grid grid-cols-1 gap-2">
                    {TREKKERS.map((t) => (
                      <div key={t} className="flex items-center gap-2">
                        <span className="text-sm w-20">{t}</span>
                        <input type="number" step="1" min="0" value={contributions[t]}
                          onChange={(e) => setContributions((prev) => ({ ...prev, [t]: Number(e.target.value || 0) }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-300" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Split Between */}
              {expenseType !== 'Fixed-Package' ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Split Between</label>
                    <button type="button" onClick={handleToggleSelectAllSplits}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold transition-colors flex items-center gap-1">
                      <input type="checkbox" checked={allTrekkersSelected} onChange={() => {}} className="rounded border-slate-300 text-indigo-600 pointer-events-none" />
                      <span>Select All</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50/50 p-2.5 rounded-xl border border-slate-200">
                    {TREKKERS.map((u) => (
                      <button type="button" key={u} onClick={() => toggleSplitParticipant(u)}
                        className={`flex items-center gap-2 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-all ${splitBetween.includes(u) ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
                        <div className={`w-3 h-3 rounded border flex items-center justify-center ${splitBetween.includes(u) ? 'border-white bg-slate-800' : 'border-slate-300 bg-white'}`}>
                          {splitBetween.includes(u) && <Check size={8} strokeWidth={4} className="text-white" />}
                        </div>
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex gap-2 text-xs text-slate-500 leading-relaxed">
                  <ShieldAlert className="shrink-0 text-slate-400" size={16} />
                  <span>Fixed-Package is charged to the shared pool and excluded from personal balances.</span>
                </div>
              )}

                    <button type="submit" disabled={syncing}
                      className="w-full bg-slate-900 text-white font-semibold py-3 px-4 rounded-xl text-sm hover:bg-slate-800 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-sm">
                      <Plus size={16} /> Log Transaction
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleAddTopUp} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Trekker</label>
                      <select value={topUpTrekker} onChange={(e) => setTopUpTrekker(e.target.value as Trekker)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-300 text-sm cursor-pointer">
                        {TREKKERS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Top-Up Amount (₹)</label>
                      <input type="number" required placeholder="2000" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 text-sm" />
                    </div>
                    <button type="submit" disabled={syncing}
                      className="w-full bg-slate-900 text-white font-semibold py-3 px-4 rounded-xl text-sm hover:bg-slate-800 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-sm">
                      Log Top-Up
                    </button>
                  </form>
                )}
            </div>
          </div>
        )}

        {/* RIGHT: Trekker Balances + WhatsApp */}
        <div className="space-y-6 md:col-span-1">

          {/* Trekker Balances */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-150">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <UsersIcon className="text-indigo-600" size={20} />
                <h3 className="font-semibold text-slate-800">Trekker Balances</h3>
              </div>
              <span className="text-[10px] bg-slate-100 text-slate-500 font-semibold px-2 py-1 rounded-full uppercase tracking-wider">4 Trekkers</span>
            </div>
            <p className="text-xs text-slate-400 mb-4">Tap a name to see their personal dashboard.</p>

            {/* Spender Leaderboard (sorted by paid desc) */}
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Spender Leaderboard</h4>
              <div className="grid grid-cols-1 gap-2">
                {([...individualCalculations].sort((a,b) => b.paid - a.paid)).map((u, idx) => (
                  <div key={u.name} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '💤'}</span>
                      <span className="font-medium">{u.name}</span>
                      <span className="text-[11px] text-slate-400">₹{u.paid.toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-slate-500">Bal: ₹{Math.round(u.balance).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {individualCalculations.map((u) => {
                const isOwed = u.balance >= 0;
                return (
                  <button
                    key={u.name}
                    onClick={() => openPersonalDashboard(u.name as Trekker)}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-indigo-50/60 hover:border-indigo-200 transition-all group active:scale-[0.98]"
                  >
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-700">{u.name}</span>
                        <ChevronRight size={13} className="text-slate-300 group-hover:text-indigo-400 transition-colors" />
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Paid: ₹{u.paid.toLocaleString()} · Share: ₹{Math.round(u.share).toLocaleString()}
                      </div>
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-1.5 rounded-lg ${isOwed ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                      {isOwed ? '+' : ''}₹{Math.round(u.balance).toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* BROKE ALERT: Paid < 40% of Share */}
            {individualCalculations.some((i) => {
              const ceiling = (personalCeiling as any)[i.name] || 15000;
              return i.share > ceiling && i.paid < 0.4 * i.share;
            }) && (
              <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm">
                {individualCalculations.filter((i) => {
                  const ceiling = (personalCeiling as any)[i.name] || 15000;
                  return i.share > ceiling && i.paid < 0.4 * i.share;
                }).map((i) => (
                  <div key={i.name}>⚠️ <strong>{i.name}</strong>'s contributions are very low. Consider letting them handle the next payment to balance the scales.</div>
                ))}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-100">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] text-slate-400 uppercase font-medium">Standard Group Spend</span>
                <span className="text-sm font-bold text-slate-700">₹{totalStandardSpend.toLocaleString()}</span>
              </div>

              {/* Emergency buffer display */}
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center">🔒</div>
                  <div>
                    <div className="text-[11px]">Emergency Buffer</div>
                    <div className="font-bold">₹{emergencyBuffer.toLocaleString()}</div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">Locked from total budget</div>
              </div>

              {/* Dual-leg pacing meters */}
              <div className="mt-4 space-y-2">
                <div className="text-xs text-slate-500 flex justify-between"><span>Manali Trek Leg</span><span>₹{Math.round((totalStandardSpend * legAllocation.manali)).toLocaleString()}</span></div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden"><div className="h-2 bg-emerald-500" style={{ width: `${manaliPct}%` }} /></div>
                <div className="text-xs text-slate-500 flex justify-between"><span>Delhi City Leg</span><span>₹{Math.round((totalStandardSpend * legAllocation.delhi)).toLocaleString()}</span></div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden"><div className="h-2 bg-indigo-500" style={{ width: `${delhiPct}%` }} /></div>
              </div>
            </div>
          </div>

          {/* WhatsApp Export */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-150">
            <h3 className="font-semibold text-slate-800 mb-2">WhatsApp Ledger Export</h3>
            <p className="text-xs text-slate-400 mb-4">Share the current ledger snapshot to your group chat.</p>
            <a
              href={`https://api.whatsapp.com/send?text=${getWhatsAppExport()}`}
              target="_blank" rel="noopener noreferrer"
              className="w-full bg-emerald-600 text-white font-semibold py-2.5 px-4 rounded-xl text-xs hover:bg-emerald-700 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-sm"
            >
              <Send size={14} /> Send to WhatsApp
            </a>
          </div>
        </div>
      </main>

      {/* ── MEMORY VAULT ────────────────────────────────────────────────────── */}
      <section className="w-full max-w-5xl bg-white rounded-2xl shadow-sm border border-slate-150 overflow-hidden mb-8">
        <div className="p-6 border-b border-slate-100 flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            <Camera className="text-violet-600" size={20} />
            <div>
              <h2 className="text-lg font-bold text-slate-800">Memory Vault</h2>
              <p className="text-xs text-slate-400">Trek photos synced to cloud · {photos.length} photos</p>
            </div>
          </div>
          <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 ${uploadingPhoto ? 'bg-violet-100 text-violet-500 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm'}`}>
            {uploadingPhoto ? <><RefreshCw size={14} className="animate-spin" /> Uploading…</> : <><Upload size={14} /> Upload Photo</>}
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={uploadingPhoto} />
          </label>
        </div>

        {photos.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3 text-slate-300">
            <ImageIcon size={48} strokeWidth={1} />
            <p className="text-sm">No photos yet. Upload your first memory!</p>
          </div>
        ) : (
          <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos.map((photo, i) => (
              <div key={photo.name} className={`group relative aspect-square rounded-xl overflow-hidden bg-slate-100 shadow-sm hover:shadow-md transition-all hover:scale-[1.03] ${photo.isOptimistic ? 'opacity-70' : ''}`}>
                <button
                  type="button"
                  onClick={() => openLightbox(photo.url)}
                  className="absolute inset-0"
                >
                  <img src={photo.url} alt={`Trek photo ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-xl" />
                </button>
                {photo.isOptimistic && (
                  <div className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold text-violet-700 shadow-sm backdrop-blur">
                    Syncing
                  </div>
                )}
                {currentUser === 'Treasurer' && !photo.isOptimistic && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeletePhoto(photo); }}
                    className="absolute right-2 top-2 rounded-full bg-white/90 p-2 text-rose-600 opacity-0 shadow-sm backdrop-blur transition-all hover:bg-rose-50 group-hover:opacity-100 active:scale-90"
                    title="Delete photo"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── EXPENSE LEDGER ──────────────────────────────────────────────────── */}
      <section className="w-full max-w-5xl bg-white rounded-2xl shadow-sm border border-slate-150 overflow-hidden mb-8">
        <div className="p-6 border-b border-slate-100 flex flex-wrap justify-between items-center gap-2">
          <h2 className="text-lg font-bold text-slate-800">Expense Ledger</h2>
          <div className="flex items-center gap-3">
            {pendingQueue.length > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-full">
                ⚠️ {pendingQueue.length} pending
              </span>
            )}
            <span className="text-xs text-slate-400">{expenses.length} records</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="py-12 text-center text-slate-400">Loading ledger…</div>
          ) : expenses.length === 0 ? (
            <div className="py-12 text-center text-slate-400">No expenses yet. Log one above!</div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-xs font-semibold uppercase border-b border-slate-100">
                  <th className="py-3 px-6">Description</th>
                  <th className="py-3 px-6">Type</th>
                  <th className="py-3 px-6">Category</th>
                  <th className="py-3 px-6">Paid By</th>
                  <th className="py-3 px-6">Split With</th>
                  <th className="py-3 px-6">Amount</th>
                  <th className="py-3 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((exp) => {
                  const isPending = pendingQueue.some((item) => item.action === 'insert_expense' && item.payload.id === exp.id);
                  const { icon, color } = getCategoryMeta(exp.category);
                  return (
                    <tr key={exp.id} className={`hover:bg-slate-50/50 transition-colors ${isPending ? 'opacity-60' : ''}`}>
                      <td className="py-4 px-6 font-medium text-slate-800">
                        <div className="flex items-center gap-2">
                          <span>{exp.description}</span>
                          {isPending && <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold uppercase">Queued</span>}
                        </div>
                        <span className="text-[10px] text-slate-400">{formatTime(exp.timestamp)}</span>
                      </td>
                      <td className="py-4 px-6">
                        {exp.type === 'Fixed-Package'
                          ? <span className="bg-slate-800 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Fixed</span>
                          : <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Standard</span>}
                      </td>
                      <td className="py-4 px-6">
                        <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 w-max ${color}`}>
                          <span>{icon}</span><span>{exp.category}</span>
                        </span>
                      </td>
                      <td className="py-4 px-6 font-semibold text-slate-700">{exp.payer}</td>
                      <td className="py-4 px-6 text-slate-500 max-w-[150px] truncate" title={normaliseSplit(exp.split_between).join(', ')}>
                        {exp.type === 'Fixed-Package' ? 'Group Pool' : normaliseSplit(exp.split_between).join(', ')}
                      </td>
                      <td className="py-4 px-6 font-bold text-slate-900">₹{exp.amount.toLocaleString()}</td>
                      <td className="py-4 px-6 text-right">
                        {currentUser === 'Treasurer' ? (
                          <button onClick={() => handleDeleteExpense(exp.id)} disabled={syncing}
                            className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-all active:scale-90 inline-flex items-center" title="Delete">
                            <Trash2 size={16} />
                          </button>
                        ) : (
                          <span className="text-slate-200 p-1.5 inline-flex items-center" title="Treasurer only">
                            <Lock size={14} />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── SYNC TOKEN BACKUP ───────────────────────────────────────────────── */}
      <footer className="w-full max-w-5xl mb-12 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-2 flex items-center gap-1.5">
          <ShieldAlert className="text-indigo-600" size={18} />
          Sync-State Backup Token
        </h3>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          Export / import the full database state as a Base64 string for offline or low-bandwidth handover.
        </p>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 flex gap-2">
            <input type="text" placeholder="Paste backup token to restore…" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
              className="w-full bg-slate-50/80 text-xs border border-slate-200 rounded-xl px-3 py-2 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 focus:border-indigo-500" />
            <button onClick={handleRestoreFromToken} disabled={syncing}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all active:scale-95 flex items-center gap-1 shrink-0">
              {restoreSuccess ? <Check size={14} /> : 'Restore'}
            </button>
          </div>
          <button onClick={generateSyncToken}
            className="bg-slate-800 hover:bg-slate-900 text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all active:scale-95 flex items-center justify-center gap-1 shrink-0">
            {copySuccess ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy Token</>}
          </button>
        </div>
      </footer>

      {/* ════════════════════════════════════════════════════════════════════════
          OVERLAY: Personal Dashboard
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTrekker && (
        <div className="fixed inset-0 z-40 flex items-center justify-end p-4 md:p-8"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(20px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closePersonalDashboard(); }}
        >
          <div
            ref={personalOverlayRef}
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Personal Dashboard</p>
                <h2 className="text-xl font-bold text-slate-900 mt-0.5">{activeTrekker}</h2>
              </div>
              <button onClick={closePersonalDashboard}
                className="p-2 rounded-xl hover:bg-slate-200 text-slate-500 transition-all active:scale-90">
                <X size={18} />
              </button>
            </div>

            {/* Stats */}
            {(() => {
              const calc = individualCalculations.find((c) => c.name === activeTrekker)!;
              const personalExp = getPersonalExpenses(activeTrekker);
              const ceiling = (personalCeiling as any)[activeTrekker] || 15000;
              const remainingPersonalBudget = ceiling - calc.share;
              const isOwed = calc.balance >= 0;

              // Category breakdown
              const catBreakdown: Record<string, number> = {};
              personalExp.forEach((e) => {
                const splits = normaliseSplit(e.split_between);
                const myShare = splits.includes(activeTrekker) ? e.amount / splits.length : 0;
                catBreakdown[e.category] = (catBreakdown[e.category] || 0) + myShare;
              });

              return (
                <div className="overflow-y-auto flex-1 p-5 space-y-5">
                  <div className={`rounded-2xl border p-4 ${
                    tripState.group_status === 'Emergency' ? 'bg-rose-50 border-rose-200'
                    : tripState.group_status === 'Behind' ? 'bg-amber-50 border-amber-200'
                    : tripState.group_status === 'Resting' ? 'bg-sky-50 border-sky-200'
                    : 'bg-emerald-50 border-emerald-200'
                  }`}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Status Beacon</span>
                    <p className={`mt-1 text-sm font-bold uppercase ${
                      tripState.group_status === 'Emergency' ? 'text-rose-700'
                      : tripState.group_status === 'Behind' ? 'text-amber-700'
                      : tripState.group_status === 'Resting' ? 'text-sky-700'
                      : 'text-emerald-700'
                    }`}>
                      Currently: {tripState.group_status}
                    </p>
                  </div>

                  {/* KPI row */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase block">Total Spent</span>
                      <span className="text-lg font-bold text-slate-800">₹{Math.round(calc.share).toLocaleString()}</span>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase block">Remaining</span>
                      <span className={`text-lg font-bold ${remainingPersonalBudget >= 0 ? 'text-slate-800' : 'text-rose-700'}`}>
                        ₹{Math.round(remainingPersonalBudget).toLocaleString()}
                      </span>
                    </div>
                    <div className={`p-3 rounded-xl border text-center ${isOwed ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                      <span className="text-[10px] font-semibold uppercase block text-slate-400">Balance Status</span>
                      <span className={`text-lg font-bold ${isOwed ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {isOwed ? '+' : '-'}₹{Math.abs(Math.round(calc.balance)).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Spend vs Budget bar */}
                  <div>
                    <div className="flex justify-between text-xs font-semibold text-slate-400 uppercase mb-1">
                      <span>Personal Budget Used (Ceiling)</span>
                      <span>{((calc.share / ceiling) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, (calc.share / ceiling) * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">Ceiling: ₹15,000 Base + ₹{((ceiling - 15000) || 0).toLocaleString()} Extra</p>
                  </div>

                  {/* Category breakdown */}
                  {Object.keys(catBreakdown).length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Where the money went</h4>
                      <div className="space-y-2">
                        {Object.entries(catBreakdown)
                          .sort(([, a], [, b]) => b - a)
                          .map(([cat, amt]) => {
                            const { icon, color } = getCategoryMeta(cat);
                            const pct = (amt / (calc.share || 1)) * 100;
                            return (
                              <div key={cat} className="flex items-center gap-3">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 w-24 shrink-0 ${color}`}>
                                  {icon} {cat}
                                </span>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs font-bold text-slate-700 w-16 text-right">₹{Math.round(amt).toLocaleString()}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* Mini ledger */}
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Mini Ledger ({personalExp.length})</h4>
                    {personalExp.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4 text-center">No transactions yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                        {personalExp.map((exp) => {
                          const splits = normaliseSplit(exp.split_between);
                          const myShare = splits.includes(activeTrekker) ? exp.amount / splits.length : 0;
                          const isPayer = exp.payer === activeTrekker;
                          const { icon } = getCategoryMeta(exp.category);
                          return (
                            <div key={exp.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-base">{icon}</span>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-slate-700 truncate">{exp.description}</p>
                                  <p className="text-[10px] text-slate-400">{formatTime(exp.timestamp)}</p>
                                </div>
                              </div>
                              <div className="text-right shrink-0 ml-2">
                                <p className={`text-xs font-bold ${isPayer ? 'text-emerald-600' : 'text-slate-700'}`}>
                                  {isPayer ? `+₹${exp.amount.toLocaleString()}` : `-₹${Math.round(myShare).toLocaleString()}`}
                                </p>
                                <p className="text-[10px] text-slate-400">{isPayer ? 'paid' : `1/${splits.length}`}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          OVERLAY: Safety Panel
      ════════════════════════════════════════════════════════════════════════ */}
      {showSafety && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(20px)' }}>
          <div
            ref={safetyPanelRef}
            className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 bg-rose-600 text-white">
              <div className="flex items-center gap-3">
                <ShieldCheck size={24} />
                <div>
                  <h2 className="text-lg font-bold">Safety Panel</h2>
                  <p className="text-xs text-rose-100">Hampta Pass Trek 2026 — Emergency Reference</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {currentUser === 'Treasurer' && (
                  <button
                    onClick={() => {
                      setSafetyDraft(tripState.emergency_data);
                      setIsEditingSafety((prev) => !prev);
                    }}
                    className="rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-white/25 active:scale-95"
                  >
                    {isEditingSafety ? 'Cancel Edit' : 'Toggle Edit'}
                  </button>
                )}
                <button onClick={closeSafetyPanel} className="p-2 rounded-xl hover:bg-rose-700 transition-all active:scale-90">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-5">
              {/* Base Camp Info */}
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="text-rose-600 shrink-0" size={18} />
                  {isEditingSafety ? (
                    <input
                      value={safetyDraft.baseCamp.name}
                      onChange={(e) => updateBaseCamp('name', e.target.value)}
                      className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-rose-400"
                    />
                  ) : (
                    <h3 className="font-bold text-slate-800">{safetyData.baseCamp.name}</h3>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {isEditingSafety ? (
                    <>
                      {(['coords', 'altitude', 'rescue', 'hospital'] as const).map((field) => (
                        <label key={field} className={field === 'rescue' || field === 'hospital' ? 'sm:col-span-2' : ''}>
                          <span className="mb-1 block text-[10px] font-semibold uppercase text-rose-500">{field}</span>
                          <input
                            value={safetyDraft.baseCamp[field]}
                            onChange={(e) => updateBaseCamp(field, e.target.value)}
                            className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-slate-700 outline-none focus:border-rose-400"
                          />
                        </label>
                      ))}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-slate-600">
                        <span className="font-semibold text-slate-500">📍 Coords:</span> {safetyData.baseCamp.coords}
                      </div>
                      <div className="flex items-center gap-2 text-slate-600">
                        <span className="font-semibold text-slate-500">⛰️ Altitude:</span> {safetyData.baseCamp.altitude}
                      </div>
                      <div className="flex items-center gap-2 text-slate-600 sm:col-span-2">
                        <Phone size={12} className="text-rose-500 shrink-0" />
                        <span className="font-semibold text-rose-600">Mountain Rescue:</span> {safetyData.baseCamp.rescue}
                      </div>
                      <div className="flex items-center gap-2 text-slate-600 sm:col-span-2">
                        <Phone size={12} className="text-rose-500 shrink-0" />
                        <span className="font-semibold text-rose-600">Nearest Hospital:</span> {safetyData.baseCamp.hospital}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Trekker Cards */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-3">Team Emergency Info</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {TREKKERS.map((name) => {
                    const info = safetyData.trekkers[name];
                    return (
                      <div key={name} className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-bold text-slate-800">{name}</h4>
                          {isEditingSafety ? (
                            <input
                              value={safetyDraft.trekkers[name].blood}
                              onChange={(e) => updateSafetyMember(name, 'blood', e.target.value)}
                              className="w-16 rounded-full border border-rose-200 bg-white px-2 py-1 text-center text-[10px] font-bold text-rose-700 outline-none focus:border-rose-400"
                            />
                          ) : (
                            <span className="flex items-center gap-1 bg-rose-100 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                              <Heart size={9} /> {info.blood}
                            </span>
                          )}
                        </div>
                        <div className="space-y-1.5 text-xs text-slate-600">
                          {isEditingSafety ? (
                            <>
                              <input
                                value={safetyDraft.trekkers[name].contact}
                                onChange={(e) => updateSafetyMember(name, 'contact', e.target.value)}
                                placeholder="Emergency contact"
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700 outline-none focus:border-rose-300"
                              />
                              <input
                                value={safetyDraft.trekkers[name].contactPhone}
                                onChange={(e) => updateSafetyMember(name, 'contactPhone', e.target.value)}
                                placeholder="Emergency number"
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-slate-700 outline-none focus:border-rose-300"
                              />
                            </>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <Phone size={11} className="text-slate-400 shrink-0" />
                                <span className="font-medium">{info.contact}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400 text-[10px] font-mono pl-0.5">{info.contactPhone}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {isEditingSafety && currentUser === 'Treasurer' && (
                <button
                  onClick={handleSaveSafety}
                  disabled={savingSafety}
                  className="w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-rose-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingSafety ? 'Saving...' : 'Save Changes'}
                </button>
              )}

              {/* Altitude Warning */}
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
                <div className="text-xs text-amber-800 leading-relaxed">
                  <p className="font-bold mb-1">High Altitude Warning</p>
                  <p>Hampta Pass crosses 4,270m. Watch for signs of AMS: headache, nausea, dizziness. Descend immediately if symptoms worsen. Do not ascend with a headache. Acclimatise properly in Manali (2,050m) before trekking.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          LIGHTBOX: Photo viewer
      ════════════════════════════════════════════════════════════════════════ */}
      {lightboxPhoto && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(12px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeLightbox(); }}
        >
          <button onClick={closeLightbox} className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all active:scale-90">
            <X size={20} />
          </button>
          <img src={lightboxPhoto} alt="Trek memory" className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl" />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          FOOTER: Creator attribution
      ════════════════════════════════════════════════════════════════════════ */}
      <footer className="mt-20 py-8 text-center text-slate-400 text-sm border-t border-slate-100">
        Crafted with ❤️ by{' '}
        <a
          href="https://www.instagram.com/noshin.ck/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-indigo-600 transition-colors"
        >
          Noshin CK
        </a>
      </footer>
    </div>
  );
}

