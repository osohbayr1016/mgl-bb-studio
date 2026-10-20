using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Smart.Core
{
    /// <summary>
    /// ФАЙЛ (DocumentKey) тус бүрийн нэг JSON хадгалалт — `docs\&lt;hash&gt;\&lt;файл&gt;.json`.
    /// Publish түүх/checkpoint, Clash үр дүн, Impact түүх бүгд энэ хэлбэрээр.
    ///
    /// ⚠️ Хадгалж БОЛОХГҮЙ түлхүүр (`Persistable == false`: CreationGUID-гүй хадгалаагүй
    /// баримт) — зөвхөн ЭНЭ session-ийн санах ойд.  Түр түлхүүрээр диск дээр
    /// файл үүсгэвэл дахин ашиглагдахгүй хог болно.
    ///
    /// Бүх алдаа `SmartStore`-ийн гэрээг дагана: ачаалах нь шидэхгүй (эвдэрсэн бол
    /// quarantine + анхдагч), хадгалах нь `false` + алдааны мэдээлэл.
    /// </summary>
    public sealed class DocStore<T> where T : class
    {
        private readonly string _file;
        private readonly int _schema;
        private readonly IReadOnlyList<ISchemaMigration> _migrations;
        private readonly SmartStore _storeOverride;
        private readonly bool _indented;
        private readonly Func<T> _factory;
        private readonly Dictionary<string, T> _memory = new Dictionary<string, T>(StringComparer.Ordinal);

        public DocStore(string fileName, int schema, Func<T> factory,
            IReadOnlyList<ISchemaMigration> migrations = null, SmartStore store = null, bool indented = true)
        {
            _file = fileName;
            _schema = schema;
            _factory = factory;
            _migrations = migrations;
            _storeOverride = store;
            _indented = indented;
        }

        private SmartStore Store { get { return _storeOverride ?? SmartStore.Default; } }

        public LoadResult<T> Load(DocumentKey key)
        {
            if (key == null) throw new ArgumentNullException("key");
            if (!key.Persistable)
            {
                T mem;
                bool had;
                lock (_memory) had = _memory.TryGetValue(key.Id, out mem);
                return new LoadResult<T> { Value = had ? mem : _factory(), Status = had ? LoadStatus.Ok : LoadStatus.Missing };
            }
            return Store.Load<T>(SmartPaths.DocFile(key, _file), _schema, _factory, _migrations);
        }

        public bool Save(DocumentKey key, T value, out string error)
        {
            if (key == null) throw new ArgumentNullException("key");
            error = null;
            if (!key.Persistable)
            {
                lock (_memory) _memory[key.Id] = value;
                return true;
            }
            return Store.Save(SmartPaths.DocFile(key, _file), _schema, value, out error, _indented);
        }

        public bool Save(DocumentKey key, T value)
        {
            string err;
            return Save(key, value, out err);
        }
    }
}
