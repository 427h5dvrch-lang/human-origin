// Hôte WebView2 de TEST — banc UI Windows du patch B (FOGG #3). Données fictives uniquement.
//   sonde <sortie>  : page fictive locale à 400×580, échelles 1.0 et 1.5 ; dimensions CSS + capture.
//   banc  <sortie>  : 32 cas (2 échelles × 2 tailles × 2 écrans × FR/EN × copie réussie/échouée)
//                     sur les vrais index.html / ho_desktop.js servis par le Vite local du banc.
// Isolement : InPrivate (aucun stockage persistant), toute ressource hors http://127.0.0.1:5181
// reçoit un 403 et toute navigation ailleurs est annulée. Pilotage par CDP uniquement.
using System.Drawing;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;

static class Programme
{
    const string ORIGINE = "http://127.0.0.1:5181";

    [STAThread]
    static int Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        var mode = args[0];
        var sortie = Path.GetFullPath(args[1]);
        Directory.CreateDirectory(sortie);
        var code = 1;
        var fenetre = new Form { FormBorderStyle = FormBorderStyle.None, StartPosition = FormStartPosition.Manual,
                                 Location = new Point(0, 0), ShowInTaskbar = false, Text = "Banc HumanOrigin (fictif)" };
        fenetre.Load += async (_, _) =>
        {
            try { code = await Executer(fenetre, mode, sortie); }
            catch (Exception ex) { File.WriteAllText(Path.Combine(sortie, "erreur.txt"), ex.ToString()); Console.Error.WriteLine(ex); code = 2; }
            fenetre.Close();
        };
        Application.Run(fenetre);
        return code;
    }

    static string Racine => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

    static async Task<int> Executer(Form fenetre, string mode, string sortie)
    {
        var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Path.GetTempPath(), "ho-wv2-" + Guid.NewGuid()));
        Console.WriteLine("WebView2 Runtime " + env.BrowserVersionString);
        var mesureSrc = File.ReadAllText(Path.Combine(Racine, "mesure.js"));
        if (mode == "sonde")
        {
            var res = new JsonArray(); var ok = true;
            foreach (var echelle in new[] { 1.0, 1.5 })
            {
                var c = await Ouvrir(env, fenetre, 400, 580, echelle, "fr", ORIGINE + "/tests/webview_bench/sonde.html");
                var v = await Evaluer(c.Vue, "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ch: document.documentElement.clientHeight, titre: (document.querySelector('h1') || {}).textContent || '' })");
                var png = await Capturer(c.Vue, Path.Combine(sortie, $"sonde_{echelle:0.0}.png"));
                var (pw, ph) = DimensionsPng(png);
                // Une page d'erreur du navigateur a aussi des dimensions et des pixels : on exige le CONTENU fictif.
                var attendu = (v?["titre"]?.GetValue<string>() ?? "").StartsWith("Sonde du banc")
                              && v?["w"]?.GetValue<double>() == 400 && v?["h"]?.GetValue<double>() == 580
                              && Math.Abs((v?["dpr"]?.GetValue<double>() ?? 0) - echelle) < 0.01
                              && pw == (int)Math.Round(400 * echelle) && ph == (int)Math.Round(580 * echelle) && png.Length > 3000
                              && c.Bloques.Count == 0 && c.Refus.Count == 0;
                ok &= attendu;
                res.Add(new JsonObject { ["echelle"] = echelle, ["css"] = v?.DeepClone(), ["png"] = $"{pw}x{ph}", ["octets"] = png.Length, ["ok"] = attendu });
                Console.WriteLine($"SONDE echelle={echelle:0.0} css={v?.ToJsonString()} png={pw}x{ph} ({png.Length} o) ok={attendu}");
                c.Controleur.Close();
            }
            File.WriteAllText(Path.Combine(sortie, "sonde.json"), new JsonObject { ["runtime"] = env.BrowserVersionString, ["cas"] = res, ["ok"] = ok }.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            return ok ? 0 : 3;
        }

        var brut = new JsonArray();
        foreach (var echelle in new[] { 1.0, 1.5 })
        foreach (var (w, h) in new[] { (400, 580), (380, 560) })
        foreach (var scenario in new[] { "continuer", "accueil" })
        foreach (var l in new[] { "fr", "en" })
        foreach (var copie in new[] { "ok", "echec" })
        {
            var url = $"{ORIGINE}/?scenario={scenario}" + (copie == "echec" ? "&copie=echec" : "");
            var c = await Ouvrir(env, fenetre, w, h, echelle, l, url);
            var expr = $"({mesureSrc})({JsonSerializer.Serialize(l)})";
            var avant = await Evaluer(c.Vue, expr);
            var nom = $"wv2_{echelle:0.0}_{scenario}_{l}_{w}x{h}_{copie}";
            if (copie == "ok") await Capturer(c.Vue, Path.Combine(sortie, nom + "_1_initial.png"));
            var libelle = l == "fr" ? "Copier le lien de vérification" : "Copy the verification link";
            await Evaluer(c.Vue, $"([...document.querySelectorAll('button')].find(b => b.innerText.trim() === {JsonSerializer.Serialize(libelle)})?.focus(), 0)");
            c.Controleur.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);   // le focus clavier va à la vue
            foreach (var type in new[] { "keyDown", "keyUp" })
                await c.Vue.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(new
                { type, key = "Enter", code = "Enter", windowsVirtualKeyCode = 13, text = type == "keyDown" ? "\r" : "", unmodifiedText = type == "keyDown" ? "\r" : "" }));
            await Task.Delay(800);
            var apres = await Evaluer(c.Vue, expr);
            await Capturer(c.Vue, Path.Combine(sortie, nom + "_2_apres_copie.png"));
            brut.Add(new JsonObject { ["moteur"] = "webview2-host", ["runtime"] = env.BrowserVersionString, ["echelle"] = echelle,
                ["w"] = w, ["h"] = h, ["scenario"] = scenario, ["langue"] = l, ["copie"] = copie,
                ["avant"] = avant?.DeepClone(), ["apres"] = apres?.DeepClone(),
                ["bloques"] = new JsonArray(c.Bloques.Select(u => (JsonNode)JsonValue.Create(u)!).ToArray()),
                ["refus"] = new JsonArray(c.Refus.Select(u => (JsonNode)JsonValue.Create(u)!).ToArray()) });
            Console.WriteLine($"CAS {nom} fait");
            c.Controleur.Close();
        }
        File.WriteAllText(Path.Combine(sortie, "brut.json"), brut.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        return 0;
    }

    sealed record Session(CoreWebView2Controller Controleur, CoreWebView2 Vue, List<string> Bloques, List<string> Refus);

    static async Task<Session> Ouvrir(CoreWebView2Environment env, Form fenetre, int w, int h, double echelle, string langue, string url)
    {
        // La fenêtre hôte mesure la taille PHYSIQUE ; la vue reçoit des bornes LOGIQUES (CSS) à l'échelle demandée.
        fenetre.ClientSize = new Size((int)Math.Ceiling(w * echelle), (int)Math.Ceiling(h * echelle));
        var options = env.CreateCoreWebView2ControllerOptions();
        options.IsInPrivateModeEnabled = true;
        var ctl = await env.CreateCoreWebView2ControllerAsync(fenetre.Handle, options);
        ctl.ShouldDetectMonitorScaleChanges = false;
        ctl.BoundsMode = CoreWebView2BoundsMode.UseRasterizationScale;
        ctl.RasterizationScale = echelle;
        ctl.Bounds = new Rectangle(0, 0, w, h);
        ctl.IsVisible = true;
        var vue = ctl.CoreWebView2;
        var bloques = new List<string>(); var refus = new List<string>();
        vue.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        vue.WebResourceRequested += (_, e) =>
        {
            if (!e.Request.Uri.StartsWith(ORIGINE + "/")) { bloques.Add(e.Request.Uri); e.Response = env.CreateWebResourceResponse(null, 403, "Bloque par le banc", ""); }
        };
        vue.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith(ORIGINE + "/")) { refus.Add(e.Uri); e.Cancel = true; }
        };
        await vue.AddScriptToExecuteOnDocumentCreatedAsync(
            $"try{{localStorage.setItem('ho.langue','{langue}')}}catch(e){{}};window.__erreurs=[];window.addEventListener('error',e=>window.__erreurs.push(String(e.message)));");
        var fini = new TaskCompletionSource<bool>();
        vue.NavigationCompleted += (_, e) => fini.TrySetResult(e.IsSuccess);
        vue.Navigate(url);
        await Task.WhenAny(fini.Task, Task.Delay(20000));
        await Task.Delay(2000);
        return new Session(ctl, vue, bloques, refus);
    }

    static async Task<JsonNode?> Evaluer(CoreWebView2 vue, string expression)
    {
        var r = await vue.CallDevToolsProtocolMethodAsync("Runtime.evaluate",
            JsonSerializer.Serialize(new { expression, returnByValue = true, awaitPromise = true }));
        return JsonNode.Parse(r)?["result"]?["value"];
    }

    static async Task<byte[]> Capturer(CoreWebView2 vue, string chemin)
    {
        var r = await vue.CallDevToolsProtocolMethodAsync("Page.captureScreenshot", "{\"format\":\"png\"}");
        var octets = Convert.FromBase64String(JsonNode.Parse(r)?["data"]?.GetValue<string>() ?? "");
        File.WriteAllBytes(chemin, octets);
        return octets;
    }

    static (int, int) DimensionsPng(byte[] p) => p.Length < 24 ? (0, 0)
        : ((p[16] << 24) | (p[17] << 16) | (p[18] << 8) | p[19], (p[20] << 24) | (p[21] << 16) | (p[22] << 8) | p[23]);
}
