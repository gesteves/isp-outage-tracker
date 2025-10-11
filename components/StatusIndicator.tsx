'use client';

interface StatusIndicatorProps {
  isOnline: boolean;
  currentOutageDuration?: number | null;
}

export default function StatusIndicator({ isOnline, currentOutageDuration }: StatusIndicatorProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 md:p-12">
      <div
        className={`w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center mb-6 transition-colors ${
          isOnline
            ? 'bg-green-500 shadow-lg shadow-green-500/50'
            : 'bg-red-500 shadow-lg shadow-red-500/50 animate-pulse'
        }`}
      >
        <span className="text-4xl md:text-6xl">
          {isOnline ? '✓' : '✗'}
        </span>
      </div>
      
      <h1 className="text-3xl md:text-5xl font-bold mb-4">
        {isOnline ? 'Internet is UP' : 'Internet is DOWN'}
      </h1>
      
      {!isOnline && currentOutageDuration !== null && currentOutageDuration !== undefined && (
        <p className="text-xl md:text-2xl text-gray-600">
          Down for {formatDuration(currentOutageDuration)}
        </p>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

