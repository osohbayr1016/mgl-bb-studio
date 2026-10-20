using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.SmartPublish.Core
{
    /// <summary>Токены утга олгогч.  `null` / хоосон = ДУТУУ утга.</summary>
    public interface ITokenSource
    {
        string Get(string name, string arg);
    }

    /* ====================================================================== */
    /*  НЭРШЛИЙН ЗАГВАР                                                        */
    /*                                                                        */
    /*    {Токен}  {Токен:аргумент}  {Токен|засагч|засагч=утга}                */
    /*    [ ... ]  = бүлгийн ДОТОРХ токен хоосон бол бүлэг БҮХЭЛДЭЭ алгасагдана */
    /*    \{ \} \[ \] \\ = шууд тэмдэгт                                        */
    /*                                                                        */
    /*  Жишээ:  {ProjectNumber}_{SheetNumber}_{SheetName}[_{Revision}]         */
    /*          {Date:yyyyMMdd}   {Param:Discipline|upper|max=3}               */
    /*                                                                        */
    /*  ⚠️ Энэ ФАЙЛ Revit-гүй: нэршил нь Revit-ээс токены утгыг ХУУЛСНЫ ДАРАА    */
    /*  цэвэр .NET.  Preview, preflight, түүх бүгд ИЖИЛ функцийг дуудна.        */
    /* ====================================================================== */

    public abstract class TemplateNode { }

    public sealed class LiteralNode : TemplateNode
    {
        public string Text { get; set; }
    }

    public sealed class TokenNode : TemplateNode
    {
        public string Name { get; set; }
        public string Arg { get; set; }
        public List<KeyValuePair<string, string>> Modifiers { get; set; } = new List<KeyValuePair<string, string>>();
        public string Raw { get; set; }
    }

    public sealed class GroupNode : TemplateNode
    {
        public List<TemplateNode> Children { get; set; } = new List<TemplateNode>();
    }

    public sealed class ParsedTemplate
    {
        public string Source { get; set; }
        public List<TemplateNode> Nodes { get; set; } = new List<TemplateNode>();
        public List<string> Errors { get; set; } = new List<string>();
        public bool IsValid { get { return Errors.Count == 0; } }

        public IEnumerable<TokenNode> Tokens()
        {
            return Walk(Nodes);
        }

        private static IEnumerable<TokenNode> Walk(IEnumerable<TemplateNode> nodes)
        {
            foreach (TemplateNode n in nodes)
            {
                var t = n as TokenNode;
                if (t != null) yield return t;
                var g = n as GroupNode;
                if (g != null)
                    foreach (TokenNode inner in Walk(g.Children)) yield return inner;
            }
        }
    }

    public sealed class NameResult
    {
        public string Name { get; set; }
        /// <summary>Хоосон байсан (бүлэгт ороогүй) токенууд.</summary>
        public List<string> MissingTokens { get; set; } = new List<string>();
        public List<string> Errors { get; set; } = new List<string>();
        public bool CharsReplaced { get; set; }
        public bool Truncated { get; set; }
        public bool IsEmpty { get { return string.IsNullOrEmpty(Name); } }
    }

    public static class NamingEngine
    {
        private static readonly HashSet<string> KnownTokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "ProjectName", "ProjectNumber", "ProjectCode", "ProjectClient", "ProjectAddress", "ProjectStatus",
            "Doc", "SheetNumber", "Number", "SheetName", "Name",
            "Revision", "RevisionDescription", "RevisionDate", "ViewType",
            "Date", "Format", "Param", "Project", "Index",
            "SheetCount", "FirstSheet", "LastSheet",
        };

        private static readonly HashSet<string> NeedsArg = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Param", "Project" };

        private static readonly HashSet<string> KnownModifiers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "upper", "lower", "trim", "nospace", "underscore", "max", "pad",
        };

        public static IReadOnlyCollection<string> TokenNames { get { return KnownTokens; } }

        /* ============================== PARSE ============================== */

        public static ParsedTemplate Parse(string template)
        {
            var result = new ParsedTemplate { Source = template ?? "" };
            if (string.IsNullOrEmpty(template))
            {
                result.Errors.Add("Нэршлийн загвар хоосон байна.");
                return result;
            }

            int pos = 0;
            result.Nodes = ParseSeq(template, ref pos, 0, result.Errors, false);
            if (pos < template.Length)
                result.Errors.Add("Хаалтны тоо таарахгүй байна (илүү `]`).");
            return result;
        }

        private static List<TemplateNode> ParseSeq(string s, ref int pos, int depth, List<string> errors, bool inGroup)
        {
            var nodes = new List<TemplateNode>();
            var lit = new StringBuilder();

            Action flush = () =>
            {
                if (lit.Length > 0)
                {
                    nodes.Add(new LiteralNode { Text = lit.ToString() });
                    lit.Clear();
                }
            };

            while (pos < s.Length)
            {
                char c = s[pos];
                if (c == '\\' && pos + 1 < s.Length)
                {
                    lit.Append(s[pos + 1]);
                    pos += 2;
                    continue;
                }

                if (c == '{')
                {
                    int end = s.IndexOf('}', pos + 1);
                    if (end < 0)
                    {
                        errors.Add("`{` хаагдаагүй байна.");
                        lit.Append(s, pos, s.Length - pos);
                        pos = s.Length;
                        break;
                    }
                    flush();
                    string body = s.Substring(pos + 1, end - pos - 1);
                    TokenNode tok = ParseToken(body, errors);
                    if (tok != null) nodes.Add(tok);
                    pos = end + 1;
                    continue;
                }

                if (c == '[')
                {
                    if (depth >= 3)
                    {
                        errors.Add("`[...]` бүлэг хэт гүн үүрлэсэн (дээд тал нь 3).");
                        lit.Append(c);
                        pos++;
                        continue;
                    }
                    flush();
                    pos++;
                    var g = new GroupNode();
                    g.Children = ParseSeq(s, ref pos, depth + 1, errors, true);
                    if (pos < s.Length && s[pos] == ']') pos++;
                    else errors.Add("`[` хаагдаагүй байна.");
                    nodes.Add(g);
                    continue;
                }

                if (c == ']')
                {
                    if (inGroup) { flush(); return nodes; }
                    // Бүлгийн гадна `]` — буцаж гаднах түвшинд алдаа болгоно.
                    flush();
                    return nodes;
                }

                if (c == '}')
                {
                    errors.Add("Илүү `}` байна.");
                    pos++;
                    continue;
                }

                lit.Append(c);
                pos++;
            }
            flush();
            return nodes;
        }

        private static TokenNode ParseToken(string body, List<string> errors)
        {
            string raw = "{" + body + "}";
            string[] parts = body.Split('|');
            string head = parts[0].Trim();
            string name = head;
            string arg = null;
            int colon = head.IndexOf(':');
            if (colon >= 0)
            {
                name = head.Substring(0, colon).Trim();
                arg = head.Substring(colon + 1);
            }

            if (name.Length == 0)
            {
                errors.Add("Хоосон токен " + raw);
                return null;
            }
            if (!KnownTokens.Contains(name))
            {
                errors.Add("Танигдаагүй токен " + raw + ".");
                return null;
            }
            if (NeedsArg.Contains(name) && string.IsNullOrWhiteSpace(arg))
            {
                errors.Add(raw + " — параметрийн нэр заавал хэрэгтэй (жишээ нь {" + name + ":Discipline}).");
                return null;
            }

            var tok = new TokenNode { Name = Canonical(name), Arg = arg, Raw = raw };
            for (int i = 1; i < parts.Length; i++)
            {
                string m = parts[i].Trim();
                if (m.Length == 0) continue;
                string mName = m, mVal = null;
                int eq = m.IndexOf('=');
                if (eq >= 0) { mName = m.Substring(0, eq).Trim(); mVal = m.Substring(eq + 1).Trim(); }
                if (!KnownModifiers.Contains(mName))
                {
                    errors.Add(raw + " — танигдаагүй засагч `" + mName + "`.");
                    continue;
                }
                if ((string.Equals(mName, "max", StringComparison.OrdinalIgnoreCase) || string.Equals(mName, "pad", StringComparison.OrdinalIgnoreCase))
                    && !IsPositiveInt(mVal))
                {
                    errors.Add(raw + " — `" + mName + "` нь эерэг бүхэл тоо шаарддаг (жишээ нь " + mName + "=3).");
                    continue;
                }
                tok.Modifiers.Add(new KeyValuePair<string, string>(mName.ToLowerInvariant(), mVal));
            }
            return tok;
        }

        private static bool IsPositiveInt(string s)
        {
            int v;
            return int.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out v) && v > 0 && v <= 200;
        }

        /// <summary>Нэрсийг нэг хэлбэрт: `Number`→`SheetNumber`, `Name`→`SheetName`, `ProjectCode`→`ProjectNumber`.</summary>
        private static string Canonical(string name)
        {
            switch (name.ToLowerInvariant())
            {
                case "number": return "SheetNumber";
                case "name": return "SheetName";
                case "projectcode": return "ProjectNumber";
                default:
                    return KnownTokens.First(k => string.Equals(k, name, StringComparison.OrdinalIgnoreCase));
            }
        }

        /* ============================ EVALUATE ============================= */

        public static NameResult Evaluate(ParsedTemplate template, ITokenSource source, NamingSettings settings)
        {
            var res = new NameResult();
            if (template == null || !template.IsValid)
            {
                if (template != null) res.Errors.AddRange(template.Errors);
                res.Name = "";
                return res;
            }

            var sb = new StringBuilder();
            EvalSeq(template.Nodes, source, settings, sb, res);
            Clean(sb.ToString(), settings, res);
            return res;
        }

        /// <summary>
        /// Хамгийн гаднах түвшин: хоосон токен `res.MissingTokens`-д бүртгэгдэнэ (policy-ийг
        /// preflight шийднэ); `Placeholder` бол орлуулах бичвэр оруулна.  Бүлэг (`[...]`) нь
        /// `EvalGroup`-ээр: ШУУД токен хоосон бол бүлэг БҮХЭЛДЭЭ алгасагдана, бүртгэгдэхгүй.
        /// </summary>
        private static void EvalSeq(List<TemplateNode> nodes, ITokenSource src, NamingSettings settings,
            StringBuilder outSb, NameResult res)
        {
            foreach (TemplateNode node in nodes)
            {
                var lit = node as LiteralNode;
                if (lit != null) { outSb.Append(lit.Text); continue; }

                var tok = node as TokenNode;
                if (tok != null)
                {
                    string value = ResolveToken(tok, src, res);
                    if (string.IsNullOrWhiteSpace(value))
                    {
                        res.MissingTokens.Add(tok.Raw);
                        MissingTokenPolicy p = settings != null ? settings.OnMissing : MissingTokenPolicy.Error;
                        if (p == MissingTokenPolicy.Placeholder)
                            outSb.Append(settings.MissingText ?? "NA");
                    }
                    else outSb.Append(value);
                    continue;
                }

                var grp = node as GroupNode;
                if (grp != null)
                {
                    var inner = new StringBuilder();
                    var directMissing = new List<string>();
                    EvalGroup(grp, src, settings, inner, res, directMissing);
                    if (directMissing.Count == 0) outSb.Append(inner);
                }
            }
        }

        private static void EvalGroup(GroupNode grp, ITokenSource src, NamingSettings settings,
            StringBuilder inner, NameResult res, List<string> directMissing)
        {
            foreach (TemplateNode node in grp.Children)
            {
                var lit = node as LiteralNode;
                if (lit != null) { inner.Append(lit.Text); continue; }

                var tok = node as TokenNode;
                if (tok != null)
                {
                    string value = ResolveToken(tok, src, res);
                    if (string.IsNullOrWhiteSpace(value)) directMissing.Add(tok.Raw);
                    else inner.Append(value);
                    continue;
                }

                var nested = node as GroupNode;
                if (nested != null)
                {
                    var innerSb = new StringBuilder();
                    var nestedMissing = new List<string>();
                    EvalGroup(nested, src, settings, innerSb, res, nestedMissing);
                    if (nestedMissing.Count == 0) inner.Append(innerSb);
                }
            }
        }

        private static string ResolveToken(TokenNode tok, ITokenSource src, NameResult res)
        {
            string value;
            try
            {
                value = src != null ? src.Get(tok.Name, tok.Arg) : null;
            }
            catch (FormatException)
            {
                res.Errors.Add(tok.Raw + " — формат буруу.");
                return null;
            }
            if (value == null) return null;

            foreach (KeyValuePair<string, string> m in tok.Modifiers)
            {
                switch (m.Key)
                {
                    case "upper": value = value.ToUpperInvariant(); break;
                    case "lower": value = value.ToLowerInvariant(); break;
                    case "trim": value = value.Trim(); break;
                    case "nospace": value = value.Replace(" ", ""); break;
                    case "underscore": value = value.Replace(' ', '_'); break;
                    case "max":
                        int max;
                        if (int.TryParse(m.Value, out max) && value.Length > max) value = SafeTruncate(value, max);
                        break;
                    case "pad":
                        int w;
                        if (int.TryParse(m.Value, out w) && value.Length < w && value.All(char.IsDigit))
                            value = value.PadLeft(w, '0');
                        break;
                }
            }
            return value;
        }

        /* ============================== SANITIZE =========================== */

        private static readonly HashSet<string> Reserved = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        };

        private static readonly char[] ExtraInvalid = { '\\', '/', ':', '*', '?', '"', '<', '>', '|' };

        /// <summary>
        /// Файлын нэрийн ХЭСГИЙГ Windows-д хүчинтэй болгоно: хориотой тэмдэгт, удирдлагын тэмдэгт,
        /// давхар тусгаарлагч, төгсгөлийн цэг/зай, түр нэр (CON...), урт.  Монгол кирилл
        /// (NFC-ээр нормчилсон) хэвээр хадгалагдана.
        /// </summary>
        public static string SanitizeSegment(string raw, string replacement, int maxLength,
            out bool charsReplaced, out bool truncated)
        {
            charsReplaced = false;
            truncated = false;
            if (string.IsNullOrEmpty(raw)) return "";
            replacement = replacement ?? "_";

            string s = raw;
            try { s = s.Normalize(NormalizationForm.FormC); } catch (ArgumentException) { }

            var invalid = new HashSet<char>(Path.GetInvalidFileNameChars());
            foreach (char c in ExtraInvalid) invalid.Add(c);

            var sb = new StringBuilder(s.Length);
            foreach (char c in s)
            {
                if (c < ' ' || invalid.Contains(c))
                {
                    sb.Append(replacement);
                    charsReplaced = true;
                }
                else if (char.IsWhiteSpace(c)) sb.Append(' ');
                else sb.Append(c);
            }
            s = sb.ToString();

            s = CollapseRuns(s);
            s = s.Trim(' ', '.', '_', '-');
            if (s.Length == 0) return "";

            if (Reserved.Contains(s) || Reserved.Contains(StripExt(s)))
            {
                s = "_" + s;
                charsReplaced = true;
            }

            if (maxLength > 0 && s.Length > maxLength)
            {
                s = SafeTruncate(s, maxLength).Trim(' ', '.', '_', '-');
                truncated = true;
            }
            return s;
        }

        private static string StripExt(string s)
        {
            int dot = s.IndexOf('.');
            return dot > 0 ? s.Substring(0, dot) : s;
        }

        /// <summary>`__`, `--`, `  `, `..` гэх мэт ДАВХАР тусгаарлагчийг нэг болгоно.</summary>
        private static string CollapseRuns(string s)
        {
            var sb = new StringBuilder(s.Length);
            char prev = '\0';
            foreach (char c in s)
            {
                bool sep = c == '_' || c == '-' || c == ' ' || c == '.';
                if (sep && c == prev) continue;
                sb.Append(c);
                prev = c;
            }
            return sb.ToString();
        }

        /// <summary>Суррогат хосыг таслахгүйгээр урт хязгаарлана.</summary>
        public static string SafeTruncate(string s, int max)
        {
            if (s == null || s.Length <= max) return s;
            int cut = max;
            if (cut > 0 && char.IsHighSurrogate(s[cut - 1])) cut--;
            return s.Substring(0, cut);
        }

        private static void Clean(string raw, NamingSettings settings, NameResult res)
        {
            string repl = settings != null ? settings.InvalidCharReplacement : "_";
            int max = settings != null ? settings.MaxLength : 120;
            bool replaced, truncated;
            res.Name = SanitizeSegment(raw, repl, max, out replaced, out truncated);
            res.CharsReplaced = replaced;
            res.Truncated = truncated;
        }
    }

    /// <summary>
    /// Хуудас/харагдац/төслийн мэдээллээс токены утга олгодог ТОДОРХОЙ эх үүсвэр.
    /// (Revit-ийн параметрийн утгыг `PublishItem.Values`-д ХУУЛСНЫ ДАРАА.)
    /// </summary>
    public sealed class PublishTokens : ITokenSource
    {
        private readonly PublishContext _ctx;
        private readonly PublishItem _item;
        private readonly PublishFormat _format;
        private readonly int _index;
        private readonly IReadOnlyList<PublishItem> _set;

        private PublishTokens(PublishContext ctx, PublishItem item, PublishFormat format, int index, IReadOnlyList<PublishItem> set)
        {
            _ctx = ctx;
            _item = item;
            _format = format;
            _index = index;
            _set = set;
        }

        public static PublishTokens ForItem(PublishContext ctx, PublishItem item, PublishFormat format, int index)
        {
            return new PublishTokens(ctx, item, format, index, null);
        }

        /// <summary>Олон хуудас/загварыг НЭГ файлд (нэгтгэсэн PDF, IFC) — хуудасны токен байхгүй (хоосон).</summary>
        public static PublishTokens ForSet(PublishContext ctx, IReadOnlyList<PublishItem> set, PublishFormat format, int index)
        {
            return new PublishTokens(ctx, null, format, index, set);
        }

        public string Get(string name, string arg)
        {
            switch (name)
            {
                case "ProjectName": return _ctx.ProjectName;
                case "ProjectNumber": return _ctx.ProjectNumber;
                case "ProjectClient": return _ctx.ProjectClient;
                case "ProjectAddress": return _ctx.ProjectAddress;
                case "ProjectStatus": return _ctx.ProjectStatus;
                case "Doc": return _ctx.DocumentTitle;
                case "Format": return _format.ToString().ToUpperInvariant();
                case "Date":
                    return _ctx.Now.ToString(string.IsNullOrWhiteSpace(arg) ? "yyyyMMdd" : arg.Trim(), CultureInfo.InvariantCulture);
                case "Index":
                    int w;
                    if (!int.TryParse(arg, NumberStyles.None, CultureInfo.InvariantCulture, out w) || w < 1 || w > 8) w = 1;
                    return _index.ToString(CultureInfo.InvariantCulture).PadLeft(w, '0');
                case "Project": return Lookup(_ctx.ProjectValues, arg);
                case "SheetCount": return _set != null ? _set.Count.ToString(CultureInfo.InvariantCulture) : null;
                case "FirstSheet": return _set != null && _set.Count > 0 ? _set[0].Number : null;
                case "LastSheet": return _set != null && _set.Count > 0 ? _set[_set.Count - 1].Number : null;
            }

            if (_item == null) return null;   // хуудасны токен нэгтгэсэн/загварын файлд БАЙХГҮЙ
            switch (name)
            {
                case "SheetNumber": return _item.Number;
                case "SheetName": return _item.Name;
                case "Revision": return _item.RevisionNumber;
                case "RevisionDescription": return _item.RevisionDescription;
                case "RevisionDate": return _item.RevisionDate;
                case "ViewType": return _item.ViewType;
                case "Param": return Lookup(_item.Values, arg);
            }
            return null;
        }

        private static string Lookup(Dictionary<string, string> dict, string key)
        {
            if (dict == null || string.IsNullOrWhiteSpace(key)) return null;
            string v;
            return dict.TryGetValue(key.Trim(), out v) ? v : null;
        }
    }
}
