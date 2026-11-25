using System.Globalization;

namespace Journeys.Server;

sealed class Backups(string connectionString, string data, ILogger<Backups> logger) : BackgroundService
{
    private readonly string directory = Path.Combine(data, "backups");
    private readonly object gate = new();

    public string? LastBackup
    {
        get
        {
            lock (gate)
            {
                var latest = Files().FirstOrDefault();
                return latest is null ? null : Db.Utc(File.GetLastWriteTimeUtc(latest));
            }
        }
    }

    private IEnumerable<string> Files() => Directory.Exists(directory)
        ? Directory.EnumerateFiles(directory, "journeys-????????-??????.db").OrderByDescending(Path.GetFileName)
        : [];

    public string Create()
    {
        lock (gate)
        {
            Directory.CreateDirectory(directory);
            var stamp = DateTimeOffset.UtcNow;
            string destination;
            // Keep separate backups when several requests arrive within one second.
            do
            {
                destination = Path.Combine(directory, "journeys-" + stamp.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".db");
                stamp = stamp.AddSeconds(1);
            } while (File.Exists(destination));
            var temporary = destination + ".tmp";
            try
            {
                using var db = new Db(connectionString);
                db.Backup(temporary);
                File.Move(temporary, destination);
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
            foreach (var old in Files().Skip(14)) File.Delete(old);
            return destination;
        }
    }

    public override Task StartAsync(CancellationToken cancellationToken)
    {
        Create();
        return base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try { Create(); }
                catch (Exception error) { logger.LogError(error, "Database backup failed."); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
