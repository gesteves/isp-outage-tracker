'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Outage, OutageStats } from '@/types';
import { storage } from '@/lib/storage';
import { checkConnectivity } from '@/lib/connectivity';
import { calculateStats, exportToCSV } from '@/lib/utils';
import { detectISP } from '@/lib/isp-detection';
import StatusIndicator from '@/components/StatusIndicator';
import StatsDisplay from '@/components/StatsDisplay';
import OutageList from '@/components/OutageList';

const CHECK_INTERVAL = parseInt(process.env.NEXT_PUBLIC_CHECK_INTERVAL_SECONDS || '60') * 1000; // Convert to milliseconds
const FAILURE_THRESHOLD = parseInt(process.env.NEXT_PUBLIC_FAILURE_THRESHOLD || '2');

export default function Dashboard() {
  const [isOnline, setIsOnline] = useState(true);
  const [outages, setOutages] = useState<Outage[]>([]);
  const [stats, setStats] = useState<OutageStats>({
    totalOutages: 0,
    totalDowntime: 0,
    uptimePercentage: 100,
    trackingStartTime: null,
  });
  const [currentOutageDuration, setCurrentOutageDuration] = useState<number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const [ispName, setIspName] = useState<string>('');
  const [isClient, setIsClient] = useState(false);
  const [countdown, setCountdown] = useState<number>(CHECK_INTERVAL / 1000);

  const consecutiveFailures = useRef(0);
  const currentOutageId = useRef<string | null>(null);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize tracking start time and detect ISP
  useEffect(() => {
    setIsClient(true);
    setLastCheckTime(new Date());
    
    const startTime = storage.getTrackingStartTime();
    if (!startTime) {
      storage.setTrackingStartTime(new Date().toISOString());
    }
    
    const loadedOutages = storage.getOutages();
    setOutages(loadedOutages);
    
    const trackingStart = storage.getTrackingStartTime();
    if (trackingStart) {
      const calculatedStats = calculateStats(loadedOutages, trackingStart);
      setStats(calculatedStats);
    }

    // Check if there's an ongoing outage
    const ongoingOutage = loadedOutages.find(o => o.endTime === null);
    if (ongoingOutage) {
      currentOutageId.current = ongoingOutage.id;
      setIsOnline(false);
    }

    // Auto-detect ISP
    detectISP().then(detectedName => {
      if (detectedName) {
        setIspName(detectedName);
      }
    });
  }, []);

  // Update stats when outages change or periodically for real-time updates
  const updateStats = useCallback(() => {
    const trackingStart = storage.getTrackingStartTime();
    if (trackingStart) {
      const calculatedStats = calculateStats(outages, trackingStart);
      setStats(calculatedStats);
    }
  }, [outages]);

  useEffect(() => {
    updateStats();
  }, [outages, updateStats]);

  // Update stats in real-time (every second) for continuous uptime calculation
  useEffect(() => {
    const statsIntervalId = setInterval(updateStats, 1000);
    
    return () => {
      clearInterval(statsIntervalId);
    };
  }, [updateStats]);

  // Update current outage duration
  useEffect(() => {
    if (!isOnline && currentOutageId.current) {
      const updateDuration = () => {
        const outage = outages.find(o => o.id === currentOutageId.current);
        if (outage) {
          const duration = (Date.now() - new Date(outage.startTime).getTime()) / 1000;
          setCurrentOutageDuration(duration);
        }
      };

      updateDuration();
      durationIntervalRef.current = setInterval(updateDuration, 1000);

      return () => {
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
        }
      };
    } else {
      setCurrentOutageDuration(null);
    }
  }, [isOnline, outages]);

  // Periodic connectivity check
  const performCheck = useCallback(async () => {
    try {
      const online = await checkConnectivity();
      setLastCheckTime(new Date());
      setCountdown(CHECK_INTERVAL / 1000); // Reset countdown

      if (!online) {
        consecutiveFailures.current += 1;

        if (consecutiveFailures.current >= FAILURE_THRESHOLD && isOnline) {
          // Start new outage
          const outageId = `outage-${Date.now()}`;
          const newOutage: Outage = {
            id: outageId,
            startTime: new Date().toISOString(),
            endTime: null,
            duration: null,
          };

          storage.addOutage(newOutage);
          setOutages(storage.getOutages());
          setIsOnline(false);
          currentOutageId.current = outageId;
        }
      } else {
        if (!isOnline && currentOutageId.current) {
          // End current outage
          const endTime = new Date().toISOString();
          const outage = storage.getOutages().find(o => o.id === currentOutageId.current);
          
          if (outage) {
            const duration = (new Date(endTime).getTime() - new Date(outage.startTime).getTime()) / 1000;
            storage.updateOutage(currentOutageId.current, {
              endTime,
              duration,
            });
            setOutages(storage.getOutages());
          }

          currentOutageId.current = null;
          setIsOnline(true);
        }

        consecutiveFailures.current = 0;
      }
    } catch (error) {
      console.error('Error checking connectivity:', error);
    }
  }, [isOnline]);

  useEffect(() => {
    performCheck(); // Initial check

    checkIntervalRef.current = setInterval(performCheck, CHECK_INTERVAL);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [performCheck]);

  // Countdown timer
  useEffect(() => {
    const countdownIntervalId = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      clearInterval(countdownIntervalId);
    };
  }, []);

  const handleExport = () => {
    exportToCSV(outages);
  };

  const handleClearLogs = () => {
    setShowClearConfirm(true);
  };

  const confirmClearLogs = () => {
    storage.clearOutages();
    storage.setTrackingStartTime(new Date().toISOString());
    setOutages([]);
    consecutiveFailures.current = 0;
    currentOutageId.current = null;
    setIsOnline(true);
    setShowClearConfirm(false);
    
    const trackingStart = storage.getTrackingStartTime();
    if (trackingStart) {
      const calculatedStats = calculateStats([], trackingStart);
      setStats(calculatedStats);
    }
  };

  const cancelClearLogs = () => {
    setShowClearConfirm(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">
            ISP Outage Tracker
          </h1>
          <p className="text-sm text-gray-500">
            {ispName && <span>{ispName} • </span>}
            {isClient && lastCheckTime && <span>Last checked: {lastCheckTime.toLocaleTimeString()} • </span>}
            {isClient && <span>Next check in {countdown}s</span>}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-lg mb-8">
          <StatusIndicator 
            isOnline={isOnline} 
            currentOutageDuration={currentOutageDuration}
          />
        </div>

        <StatsDisplay stats={stats} />

        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <h2 className="text-xl md:text-2xl font-bold">Outage History</h2>
            <div className="flex gap-3 w-full md:w-auto">
              <button
                onClick={handleExport}
                disabled={outages.length === 0}
                className="flex-1 md:flex-none px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
              >
                Export CSV
              </button>
              <button
                onClick={handleClearLogs}
                disabled={outages.length === 0}
                className="flex-1 md:flex-none px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
              >
                Clear Logs
              </button>
            </div>
          </div>

          <OutageList outages={outages} />
        </div>
      </div>

      {/* Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Clear All Logs?</h3>
            <p className="text-gray-600 mb-6">
              This will permanently delete all outage records and reset the tracking start time. 
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelClearLogs}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmClearLogs}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

