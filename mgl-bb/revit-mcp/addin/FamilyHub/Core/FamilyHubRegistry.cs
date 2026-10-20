using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.FamilyHub.Core
{
    /// <summary>
    /// Төслийн бүртгэлийн санах ойн загвар.  Revit тал (`ExtensibleStorageRegistryStore`)
    /// үүнийг JSON болгож `DataStorage` элемент дээр хадгална; энэ анги нь
    /// хайлтын ГУРВАН түлхүүрийг мэднэ:
    ///   A) нийлүүлэгчийн танигч   B) SHA-256   C) Revit family нэр.
    /// </summary>
    public sealed class FamilyHubRegistry
    {
        public const int CurrentSchemaVersion = 1;

        [JsonPropertyName("schema")] public int SchemaVersion { get; set; } = CurrentSchemaVersion;
        [JsonPropertyName("entries")] public List<FamilyHubRegistryEntry> Entries { get; set; } = new List<FamilyHubRegistryEntry>();

        private static readonly JsonSerializerOptions Json = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = false,
        };

        public static FamilyHubRegistry FromJson(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new FamilyHubRegistry();
            try
            {
                FamilyHubRegistry r = JsonSerializer.Deserialize<FamilyHubRegistry>(json, Json);
                if (r == null) return new FamilyHubRegistry();
                if (r.Entries == null) r.Entries = new List<FamilyHubRegistryEntry>();
                return r;
            }
            catch
            {
                // Эвдэрсэн JSON — хоосноос эхэлнэ; давхардлын шалгалт л сулрана, family алдагдахгүй.
                return new FamilyHubRegistry();
            }
        }

        public string ToJson()
        {
            return JsonSerializer.Serialize(this, Json);
        }

        public FamilyHubRegistryEntry FindByProviderIdentity(string identity)
        {
            if (string.IsNullOrEmpty(identity)) return null;
            foreach (FamilyHubRegistryEntry e in Entries)
                if (string.Equals(e.ProviderIdentity, identity, StringComparison.Ordinal)) return e;
            return null;
        }

        public FamilyHubRegistryEntry FindBySha256(string sha256)
        {
            if (string.IsNullOrEmpty(sha256)) return null;
            foreach (FamilyHubRegistryEntry e in Entries)
                if (string.Equals(e.Sha256, sha256, StringComparison.OrdinalIgnoreCase)) return e;
            return null;
        }

        public FamilyHubRegistryEntry FindByFamilyName(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            foreach (FamilyHubRegistryEntry e in Entries)
                if (string.Equals(e.RevitFamilyName, name, StringComparison.Ordinal)) return e;
            return null;
        }

        public List<FamilyHubRegistryEntry> FindByFamilyId(long familyId)
        {
            var list = new List<FamilyHubRegistryEntry>();
            foreach (FamilyHubRegistryEntry e in Entries)
                if (e.RevitFamilyId == familyId) list.Add(e);
            return list;
        }

        /// <summary>Ижил нийлүүлэгчийн танигчтай мөр байвал СОЛИНО (давхардуулахгүй).</summary>
        public void Upsert(FamilyHubRegistryEntry entry)
        {
            if (entry == null) throw new ArgumentNullException("entry");
            for (int i = 0; i < Entries.Count; i++)
            {
                if (string.Equals(Entries[i].ProviderIdentity, entry.ProviderIdentity, StringComparison.Ordinal))
                {
                    Entries[i] = entry;
                    return;
                }
            }
            Entries.Add(entry);
        }

        public int RemoveWhere(Predicate<FamilyHubRegistryEntry> pred)
        {
            return Entries.RemoveAll(pred);
        }
    }
}
