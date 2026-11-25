using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.Features;
using Row = System.Collections.Generic.Dictionary<string, object?>;

namespace Journeys.Server;

static class Releases
{
    private const long MaxApkSize = 200L * 1024 * 1024;
    private const long MaxRequestSize = MaxApkSize + 1024 * 1024;

    internal static void Map(WebApplication app, string data)
    {
        var folder = Path.Combine(data, "releases");
        Directory.CreateDirectory(folder);

        app.MapGet("/api/app/latest", (Db db) =>
        {
            var release = Latest(db) ?? throw new ApiError(404, "No published release is available.");
            return Results.Ok(new
            {
                version = release["version"], versionCode = release["versionCode"], notes = release["notes"],
                size = release["size"], sha256 = release["sha256"],
                url = "/api/app/download/" + Uri.EscapeDataString((string)release["version"]!)
            });
        });
        app.MapGet("/api/app/download/{version}", (string version, Db db) =>
        {
            var release = db.Row("SELECT * FROM releases WHERE version = $version AND published = 1", ("version", version))
                ?? throw new ApiError(404, "Published release not found.");
            var path = Path.Combine(folder, (string)release["version"]! + ".apk");
            if (!File.Exists(path)) throw new ApiError(404, "Release file not found.");
            return Results.File(path, "application/vnd.android.package-archive", $"PokeJourneys-{version}.apk", enableRangeProcessing: true);
        });
        app.MapGet("/download", (HttpContext context, Db db) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.ContentSecurityPolicy = "default-src 'none'; base-uri 'none'; form-action 'none'";
            var release = Latest(db);
            var content = release is null ? "<p>No published release is available yet.</p>" :
                $"<h2>Version {WebUtility.HtmlEncode((string)release["version"]!)}</h2>" +
                $"<p>{WebUtility.HtmlEncode((string)release["notes"]!).Replace("\r\n", "\n").Replace("\n", "<br>")}</p>" +
                $"<p><a href=\"/api/app/download/{Uri.EscapeDataString((string)release["version"]!)}\">Download PokeJourneys for Android</a> ({Convert.ToInt64(release["size"]).ToString("N0", CultureInfo.InvariantCulture)} bytes)</p>";
            return Results.Content("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Download PokeJourneys</title>" +
                "</head><body><main><h1>PokeJourneys Online</h1>" + content + "</main></body></html>",
                "text/html; charset=utf-8", statusCode: release is null ? 404 : 200);
        });

        var api = app.MapGroup("/api/admin/releases");
        api.MapGet("/", (Db db) => Results.Ok(db.Rows("SELECT * FROM releases ORDER BY version_code DESC").Select(Shape)));
        api.MapPost("/", (HttpContext context, Db db) => Upload(context, db, folder));
        api.MapPut("/{id}", async (string id, HttpRequest request, Db db) =>
        {
            var releaseId = AdminApi.Id(id);
            var body = await AdminApi.Body(request, "published");
            var reason = AdminApi.Text(body, "reason").Trim();
            if (!body.TryGetProperty("published", out var value) || value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                throw new ApiError("published must be a boolean.");
            var published = value.GetBoolean();
            return Results.Ok(db.Write(() =>
            {
                var before = Read(db, releaseId);
                if (published && !File.Exists(Path.Combine(folder, (string)before["version"]! + ".apk")))
                    throw new ApiError(404, "Release file not found.");
                db.Execute("UPDATE releases SET published = $published WHERE id = $id", ("published", published), ("id", releaseId));
                Changed();
                var after = Read(db, releaseId);
                var auditId = db.Audit("release.publish", $"release:{releaseId}", before, after, reason);
                return new { auditId, before, after };
            }));
        });
    }

    private static (long Code, string Version, DateTime At) required = (0, "", DateTime.MinValue);

    /// The app sends its versionCode as X-App-Version; one older than the newest published release (or none) gets
    /// 426 Upgrade Required, and the app opens its update screen. With nothing published, every version is welcome.
    internal static void RequireCurrent(Db db, HttpRequest request)
    {
        var latest = required;
        if (DateTime.UtcNow - latest.At > TimeSpan.FromSeconds(30))
        {
            var row = Latest(db);
            required = latest = (row is null ? 0 : Convert.ToInt64(row["versionCode"]), row?["version"] as string ?? "", DateTime.UtcNow);
        }
        if (latest.Code == 0) return;
        if (long.TryParse(request.Headers["X-App-Version"].ToString(), out var code) && code >= latest.Code) return;
        throw new ApiError(426, $"Update PokeJourneys to version {latest.Version} to keep playing.");
    }

    /// Publishing or unpublishing takes effect at once, not after the 30 seconds above.
    internal static void Changed() => required = (0, "", DateTime.MinValue);

    private static Row? Latest(Db db) => db.Row("SELECT * FROM releases WHERE published = 1 ORDER BY version_code DESC LIMIT 1");

    private static Row Shape(Row row)
    {
        row["published"] = Convert.ToInt64(row["published"]) != 0;
        return row;
    }

    private static Row Read(Db db, long id) => Shape(db.Find("releases", new() { ["id"] = id })
        ?? throw new ApiError(404, "Release not found."));

    private static string FormText(IFormCollection form, string name, bool allowEmpty = false)
    {
        var values = form[name];
        if (values.Count != 1) throw new ApiError($"{name} must occur once.");
        var text = values.ToString().Trim();
        if (!allowEmpty && text.Length == 0) throw new ApiError($"{name} is required.");
        return text;
    }

    private static async Task<IResult> Upload(HttpContext context, Db db, string folder)
    {
        var request = context.Request;
        var limit = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = MaxRequestSize;
        if (request.ContentLength > MaxRequestSize) throw new ApiError(413, "APK must be under 200 MB.");
        if (!request.HasFormContentType || !request.ContentType!.StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase))
            throw new ApiError("Content-Type must be multipart/form-data.");
        IFormCollection form;
        try
        {
            form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = MaxApkSize, ValueLengthLimit = 65536 }, context.RequestAborted);
        }
        catch (InvalidDataException) { throw new ApiError("Invalid multipart upload; APK must be under 200 MB and text fields at most 64 KB."); }
        catch (BadHttpRequestException error) { throw new ApiError(error.StatusCode, "Invalid multipart upload or APK exceeds the upload limit."); }
        var version = FormText(form, "version");
        if (version.Length > 64 || !Regex.IsMatch(version, @"\A[0-9]+(?:\.[0-9]+){1,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\z"))
            throw new ApiError("version must look like 1.6.0, with optional pre-release or build metadata (at most 64 characters).");
        if (!int.TryParse(FormText(form, "versionCode"), NumberStyles.None, CultureInfo.InvariantCulture, out var versionCode) || versionCode < 1)
            throw new ApiError("versionCode must be a positive 32-bit integer.");
        var notes = FormText(form, "notes", allowEmpty: true);
        var reason = FormText(form, "reason");
        if (form.Files.Count != 1 || form.Files[0].Name != "apk") throw new ApiError("One apk file is required.");
        var apk = form.Files[0];
        if (apk.Length < 2 || apk.Length >= MaxApkSize) throw new ApiError("APK must be a ZIP file under 200 MB.");

        var temporary = Path.Combine(folder, Guid.NewGuid().ToString("N") + ".part");
        var destination = Path.Combine(folder, version + ".apk");
        var moved = false;
        try
        {
            string sha256;
            await using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
            {
                await apk.CopyToAsync(file, context.RequestAborted);
                file.Position = 0;
                if (file.ReadByte() != 'P' || file.ReadByte() != 'K') throw new ApiError("APK must be a ZIP file starting with PK.");
                file.Position = 0;
                try
                {
                    using var zip = new ZipArchive(file, ZipArchiveMode.Read, leaveOpen: true);
                    _ = zip.Entries.Count;
                }
                catch (InvalidDataException) { throw new ApiError("APK must be a valid ZIP file."); }
                file.Position = 0;
                sha256 = Convert.ToHexString(await SHA256.HashDataAsync(file, context.RequestAborted)).ToLowerInvariant();
            }
            var result = db.Write(() =>
            {
                if (db.Number("SELECT COUNT(*) FROM releases WHERE version = $version", ("version", version)) != 0)
                    throw new ApiError(409, "This version already exists.");
                if (versionCode <= db.Number("SELECT COALESCE(MAX(version_code), 0) FROM releases"))
                    throw new ApiError(409, "versionCode must be higher than every existing release.");
                if (File.Exists(destination)) throw new ApiError(409, "A file for this version already exists.");
                File.Move(temporary, destination);
                moved = true;
                db.Execute("""
                    INSERT INTO releases (version, version_code, notes, size, sha256, published, created)
                    VALUES ($version, $code, $notes, $size, $sha256, 0, $created)
                    """, ("version", version), ("code", versionCode), ("notes", notes), ("size", apk.Length), ("sha256", sha256), ("created", Db.Now()));
                var id = db.Number("SELECT last_insert_rowid()");
                var after = Read(db, id);
                var auditId = db.Audit("release.upload", $"release:{id}", null, after, reason);
                return new { auditId, before = (object?)null, after };
            });
            return Results.Ok(result);
        }
        catch
        {
            if (moved) File.Delete(destination);
            throw;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
