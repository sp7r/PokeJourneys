using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Journeys.Server;
using Microsoft.Data.Sqlite;

var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PokeJourneysServer");
var urls = "http://127.0.0.1:5280";
var seedDemo = false;
var devSignin = false;
var botSignin = false;
var startBots = 0;
var adminLocalOnly = false;
string? hubWalk = null;
string? hubLayout = null;
var discordApi = "https://discord.com/api";
for (var i = 0; i < args.Length; i++)
{
    var option = args[i].Split('=', 2);
    if (option[0] == "--seed-demo" && option.Length == 1)
    {
        seedDemo = true;
        continue;
    }
    if (option[0] == "--dev-signin" && option.Length == 1)
    {
        devSignin = true;
        continue;
    }
    if (option[0] == "--bot-signin" && option.Length == 1)
    {
        botSignin = true;
        continue;
    }
    if (option[0] == "--admin-local-only" && option.Length == 1)
    {
        adminLocalOnly = true;
        continue;
    }
    if (option[0] is not ("--data" or "--urls" or "--discord-api" or "--bots" or "--hub-walk" or "--hub-layout"))
        throw new ArgumentException($"Unknown option: {args[i]}");
    var value = option.Length == 2 ? option[1] : ++i < args.Length ? args[i] : "";
    if (string.IsNullOrWhiteSpace(value) || value.StartsWith("--", StringComparison.Ordinal))
        throw new ArgumentException($"{option[0]} requires a value.");
    if (option[0] == "--data") data = value;
    else if (option[0] == "--urls") urls = value;
    else if (option[0] == "--hub-walk") hubWalk = File.Exists(value) ? value : throw new ArgumentException($"--hub-walk: {value} doesn't exist.");
    else if (option[0] == "--hub-layout") hubLayout = File.Exists(value) ? value : throw new ArgumentException($"--hub-layout: {value} doesn't exist.");
    else if (option[0] == "--bots") startBots = int.TryParse(value, out var bots) && bots is >= 0 and <= BotPlayers.MaxBots
        ? bots : throw new ArgumentException($"--bots must be a number from 0 to {BotPlayers.MaxBots}.");
    else discordApi = value;
}
// --bot-signin is for a public server: the sign-in without Discord then only takes bot names ("Bot 01"...).
var botsAvailable = devSignin || botSignin;
if (startBots > 0 && !botsAvailable) throw new ArgumentException("--bots requires --dev-signin or --bot-signin.");
if (!Uri.TryCreate(discordApi.TrimEnd('/') + "/", UriKind.Absolute, out var discordUri) || discordUri.Scheme is not ("http" or "https"))
    throw new ArgumentException("--discord-api must be an HTTP or HTTPS URL.");

data = Path.GetFullPath(data);
Directory.CreateDirectory(data);
var connectionString = new SqliteConnectionStringBuilder
{
    DataSource = Path.Combine(data, "journeys.db"),
    ForeignKeys = true
}.ToString();
using (var db = new Db(connectionString))
{
    db.Initialize();
    Safety.Initialize(db);
    if (seedDemo) DemoSeed.Run(db);
}

var keyPath = Path.Combine(data, "admin-key.txt");
string adminKey;
if (File.Exists(keyPath)) adminKey = File.ReadAllText(keyPath).Trim();
else
{
    adminKey = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    using var file = new StreamWriter(new FileStream(keyPath, FileMode.CreateNew, FileAccess.Write, FileShare.None));
    file.WriteLine(adminKey);
    Console.WriteLine($"Admin key: {adminKey}");
}
if (adminKey.Length != 64 || !adminKey.All(Uri.IsHexDigit))
    throw new InvalidOperationException("admin-key.txt must contain a 64-character hexadecimal key.");
var keyHash = SHA256.HashData(Encoding.UTF8.GetBytes(adminKey));

var webRoot = new[]
{
    Path.Combine(Directory.GetCurrentDirectory(), "server", "journeys-server", "wwwroot"),
    Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"),
    Path.Combine(AppContext.BaseDirectory, "wwwroot")
}.FirstOrDefault(Directory.Exists);
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = [],
    ContentRootPath = AppContext.BaseDirectory,
    WebRootPath = webRoot ?? "wwwroot"
});
builder.WebHost.UseUrls(urls);
builder.Services.AddScoped(_ => new Db(connectionString));
builder.Services.AddHttpClient("discord", client => client.BaseAddress = discordUri);
builder.Services.AddSingleton(services => new Backups(connectionString, data, services.GetRequiredService<ILogger<Backups>>()));
builder.Services.AddHostedService(services => services.GetRequiredService<Backups>());
// Bots sign in through the development sign-in, which only answers loopback addresses.
var botUrl = System.Text.RegularExpressions.Regex.Replace(urls.Split(';')[0], @"//(0\.0\.0\.0|\*|\+|\[::\])", "//127.0.0.1");
builder.Services.AddSingleton(services => new Live(connectionString, services.GetRequiredService<ILogger<Live>>()));
// Bots read the hub's layout from the repository when the server runs from it; --hub-walk adds the walkable tiles.
for (var folder = new DirectoryInfo(Directory.GetCurrentDirectory()); hubLayout is null && folder is not null; folder = folder.Parent)
    if (File.Exists(Path.Combine(folder.FullName, "hub", "victory", "data", "layout.json")))
        hubLayout = Path.Combine(folder.FullName, "hub", "victory", "data", "layout.json");
if (botsAvailable) Console.WriteLine(hubLayout is null ? "Bot players: no hub layout.json found; they wander without places." :
    $"Bot players: places from {hubLayout}; {(hubWalk is null ? "no --hub-walk, so they walk without a map" : $"walkable tiles from {hubWalk}")}.");
builder.Services.AddSingleton(services => new BotPlayers(botUrl, botsAvailable, botsAvailable ? new BotWorld(hubLayout, hubWalk) : new BotWorld(null, null),
    connectionString, services.GetRequiredService<ILogger<BotPlayers>>()));
var app = builder.Build();

app.Use(async (context, next) =>
{
    // With --admin-local-only the console and admin API answer only direct connections from this machine (an SSH
    // tunnel lands here too). Anything through the HTTPS proxy carries its forwarding headers and gets a 404.
    if (adminLocalOnly && (context.Request.Path.StartsWithSegments("/admin") || context.Request.Path.StartsWithSegments("/api/admin")))
    {
        var remote = context.Connection.RemoteIpAddress;
        var proxied = context.Request.Headers.ContainsKey("X-Forwarded-For") || context.Request.Headers.ContainsKey("X-Real-IP") ||
            context.Request.Headers.ContainsKey("Forwarded");
        if (proxied || remote is null || !System.Net.IPAddress.IsLoopback(remote.IsIPv4MappedToIPv6 ? remote.MapToIPv4() : remote))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
    }
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.Headers.CacheControl = "no-store";
        try
        {
            if (context.Request.Path.StartsWithSegments("/api/admin"))
            {
                var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(context.Request.Headers["X-Admin-Key"].ToString()));
                if (!CryptographicOperations.FixedTimeEquals(keyHash, suppliedHash))
                    throw new ApiError(401, "A valid admin key is required.");
            }
            else
            {
                // An app older than the newest published release has to update first (the update itself, the status,
                // crash logs and the hub's live socket, opened only after /api/me passed, stay open).
                var path = context.Request.Path;
                if (!path.StartsWithSegments("/api/app") && !path.StartsWithSegments("/api/status") && !path.StartsWithSegments("/api/crash") &&
                    !path.StartsWithSegments("/api/live") && !path.StartsWithSegments("/api/auth/dev"))
                    Releases.RequireCurrent(context.RequestServices.GetRequiredService<Db>(), context.Request);
                if (!path.StartsWithSegments("/api/auth") && !path.StartsWithSegments("/api/status") && !path.StartsWithSegments("/api/app"))
                    GameApi.Authenticate(context.RequestServices.GetRequiredService<Db>(), context);
            }
            await next(context);
            if (context.Response.StatusCode == 404 && !context.Response.HasStarted)
                await context.Response.WriteAsJsonAsync(new { error = "Endpoint not found." });
        }
        catch (ApiError error)
        {
            context.Response.StatusCode = error.Status;
            await context.Response.WriteAsJsonAsync(new { error = error.Message });
        }
        catch (Exception error) when (error is JsonException or BadHttpRequestException)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(new { error = "A valid JSON object is required." });
        }
        return;
    }
    if (context.Request.Path == "/admin")
    {
        context.Response.Redirect("/admin/");
        return;
    }
    await next(context);
});

app.UseDefaultFiles(new DefaultFilesOptions { RequestPath = "/admin" });
// no-cache: browsers check for a newer console after each deploy (the ETag keeps it cheap).
app.UseStaticFiles(new StaticFileOptions { RequestPath = "/admin", OnPrepareResponse = file => file.Context.Response.Headers.CacheControl = "no-cache" });
app.MapAdmin(connectionString);
app.MapGame(devSignin, botSignin);
Releases.Map(app, data);
Safety.Map(app);
Live.MapLive(app);
BotPlayers.MapBots(app);
// The admin console's last on/off choice wins over --bots.
app.Lifetime.ApplicationStarted.Register(() => app.Services.GetRequiredService<BotPlayers>().Resume(startBots));
app.Run();
