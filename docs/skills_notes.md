# Matt Pocock – "Skills for Real Engineers" Notları

Kaynak: <https://www.aihero.dev/skills> · Depo: `mattpocock/skills`

> İndirme/kurulum kısmı bu notta atlandı.

## Genel felsefe

GSD, BMAD, Spec-Kit gibi yaklaşımlar süreci tamamen ele geçirip senin kontrolünü alır.
Bu skill'ler ise **küçük, uyarlanabilir ve birleştirilebilir** olacak şekilde tasarlanmış;
her modelle çalışıyor. Amaç "vibe coding" değil, mühendislik disiplinini korumak.

Dört tipik AI hatasını çözmeyi hedefliyorlar:

1. **Ajan istediğimi yapmadı** → grilling (sorgulama) oturumları
2. **Ajan çok konuşkan / jargonu anlamıyor** → ortak dil (`CONTEXT.md`, ADR'ler)
3. **Kod çalışmıyor** → feedback döngüleri (TDD, debugging)
4. **Çamur topu mimari** → modül tasarımına önem vermek

İki tür skill var:

- **User-invoked**: sadece sen `/isim` yazınca çalışır, orkestrasyon yapar.
- **Model-invoked**: ajan da kendiliğinden çağırabilir; tekrar kullanılabilir disiplini taşır.

Bir user-invoked skill, model-invoked skill'leri çağırabilir ama başka bir user-invoked
skill'i çağıramaz.

---

## Ana akış: fikir → ship

| Sıra | Skill | Ne yapar |
|---|---|---|
| 1 | **`/grill-with-docs`** | Fikri röportajla keskinleştirir; öğrendiğini `CONTEXT.md` ve ADR'lere yazar (kalıcı iz bırakır). Bir repo içindeysen başlangıç noktası. |
| 2 | **`/prototype`** (gerekirse) | Kağıt üzerinde çözülemeyen sorular (state modeli, iş mantığı, görülmesi gereken UI) için atılabilir kod. Tek paylaşılabilir HTML dosyası ya da tek route'tan geçilebilen birkaç radikal UI varyasyonu. `prototype/<isim>` dalında birincil kaynak olarak saklanır. |
| 3a | **`/to-spec`** | Konuşmayı bir spec'e dönüştürüp issue tracker'a yayınlar. Röportaj yok, sadece sentez. |
| 3b | **`/to-tickets`** | Plan/spec/konuşmayı "tracer-bullet" ticket'lara böler; her biri kendi bloklama kenarlarını (blocking edges) belirtir. Yerel tracker'da dosya, gerçek tracker'da native bağlantı. |
| 3c | **`/implement`** | Bir spec veya ticket setini hayata geçirir. İçeride `/tdd`'yi önceden anlaşılan noktalarda sürer, commit'ten önce `/code-review` ile kapatır. |
| — | **`/wayfinder`** | Tek oturuma sığmayan devasa/sisli işler (greenfield proje, büyük feature). Issue tracker üzerinde "karar ticket'ları" (decision tickets) haritası çıkarır, birer birer çözer. **Deliverable değil karar üretir**; sis dağılınca `/to-spec`'e devreder. En yorucu akış, iyi tanımlı feature'lar için kullanma. |

**Bağlam hijyeni:** 1–3 adımları tek kesintisiz bağlam penceresinde tutulur
(`/to-tickets`'a kadar compact/clear yok). Her `/implement` temiz başlar.
Sınır: **smart zone** (~150k token) — bu penceredeyken model hâlâ keskin düşünür.

---

## On-ramp'ler (işi başlatan durumlar)

- **`/triage`** — Senin oluşturmadığın issue'ları (bug raporları, gelen istekler, dış PR'lar)
  bir durum makinesi (triage rolleri) içinde ilerletir, kategorize eder, doğrular, gerekirse
  grilling yapar, ajana hazır brief yazar. `/to-tickets` çıktılarına uygulanmaz.
- **`/diagnosing-bugs`** — Zor buglar ve performans regresyonları için disiplinli teşhis
  döngüsü. Elinde **bu bug'da kırmızı olan tek komut** (sıkı feedback loop) olmadan teori
  üretmeyi reddeder: minimize et → hipotez → enstrümante et → düzelt → regresyon testi.
  Post-mortem'de "iyi bir seam yok" çıkarsa `/improve-codebase-architecture`'a devreder.

---

## Codebase sağlığı / upkeep

- **`/improve-codebase-architecture`** — Codebase'i "deepening opportunities" (derinleştirme
  fırsatları) için tarar, görsel HTML raporu sunar, seçtiğin adayı grilling'den geçirir.
  Birkaç günde bir çalıştırılması öneriliyor. Bir survey'dir; çamuru senin yerine çözmez,
  adayları bulur.
- **`/codebase-design`** — Derin modül tasarımı için ortak sözlük (module, interface, depth,
  seam, adapter, leverage, locality). "Küçük arayüz arkasında çok davranış, temiz bir
  seam'de, o arayüzden test edilebilir." `/tdd` ve `/improve-codebase-architecture` bu dili
  konuşur.

---

## Altta çalışan sözlük katmanı

- **`/domain-modeling`** — Projenin *alan* dilini keskinleştirir: bulanık terime meydan okur,
  aşırı yüklenmiş kelimeyi ("account" üç iş birden yapıyor) çözer, geri döndürülmesi zor
  kararları ADR olarak kaydeder. `CONTEXT.md`'yi temiz bir sözlük tutar.
- **`/grilling`** — Röportaj primitifi: turlar, "frontier", gerçekleri bulmak ajanın işi /
  kararlar senin. `grill-me`, `grill-with-docs`, `triage`, `wayfinder`,
  `improve-codebase-architecture` bunun üzerine kurulu.

---

## TDD ve review

- **`/tdd`** — Red-green-refactor döngüsüyle test-first geliştirme. Feature'ı/bug fix'i her
  seferinde bir dikey dilim halinde yapar. İyi/kötü test rehberi ve mocking notları içerir.
- **`/code-review`** — Sabit bir noktadan (commit/branch/tag/merge-base) beri olan diff'i iki
  eksende inceler: **Standards** (repo'nun kodlama standartlarına + Fowler smell taban
  çizgisine uyuyor mu?) ve **Spec** (kaynak issue/spec'i sadık şekilde uyguluyor mu?).
  Paralel alt-ajanlarla, birbirini kirletmeden.

---

## Standalone (akış dışı) engineering skill'leri

- **`/resolving-merge-conflicts`** — Devam eden merge/rebase çakışmasını hunk hunk çözer;
  satır seçerek değil, her tarafın birincil kaynağına dayanan **niyete** göre. Sonra işlemi
  bitirir, asla `--abort` yapmaz.
- **`/research`** — Okuma işini bir arka plan ajanına devreder: soruyu yüksek güvenli birincil
  kaynaklara karşı araştırır, repo'ya kaynak gösteren Markdown dosyası bırakır. Sen çalışmaya
  devam edersin.
- **`/wizard`** — Sadece bir insanın yapabileceği adımlar için interaktif bash sihirbazı
  üretir: altyapı provizyonu, kimlik bilgileri/CI secret kurulumu, tanıdık olmayan üçüncü
  parti dashboard'da tıklama, tek seferlik migration/cutover. Her URL'yi açar, her değeri
  yakalar, `.env` ve GitHub secrets'a yazar. Ajanın kendisi yapabileceği şeyler için
  kullanılmaz.
- **`/ask-matt`** — Bu depodaki user-invoked skill'ler üzerinde bir router: "durumuma hangi
  skill/akış uyuyor?" diye sorarsın.
- **`/setup-matt-pocock-skills`** — Ön koşul. Repo başına bir kez: issue tracker
  (GitHub/Linear/yerel dosyalar), triage etiket sözlüğü, doküman yerleşimi ayarlanır.

---

## Productivity skill'leri (koda özel değil)

- **`/grill-me`** — `grill-with-docs` ile aynı acımasız röportaj ama **stateless**: yerel
  hiçbir şey kaydetmez, `CONTEXT.md` kurmaz. Bir çalışma dizininde değilken (plan, tasarım,
  yazı) kullanılır.
- **`/handoff`** — Mevcut konuşmayı bir devir dokümanına sıkıştırır ki başka bir ajan işe
  devam edebilsin. Sadece: yeni harness (Claude→Codex), yeni dizin/repo, iş arkadaşına devir,
  ya da faz ortasında yan görev çatallama için.
- **`/teach`** — Kullanıcıya bir kavramı/beceriyi birden çok oturumda öğretir; mevcut dizini
  stateful öğrenme alanı olarak kullanır.
- **`/to-questionnaire`** — Tek başına cevaplayamadığın bir kararı, cevaplayabilecek kişi için
  Markdown anketine dönüştürür. Konu hakkında değil, **gönderim** hakkında sorgular seni
  (kime gidiyor, ne geri lazım).
- **`/wait-what`** — Bir mesaj "düşmediği" (anlaşılmadığı) an ateşlenir. Ajan söylediğini,
  senin eksik olduğun bağlamla, sade İngilizceyle ve `CONTEXT.md` sözlüğüyle yeniden anlatır.
  Herhangi bir skill'in içinde kullanılabilir.
- **`/writing-for-agents`** — Ajanların tükettiği dokümanları (skill'ler,
  AGENTS.md/CLAUDE.md, pointer ile ulaşılan dokümanlar) yazma referansı.

---

## In-progress (beta — plugin'e dahil değil, habersiz değişebilir)

- **`/loop-me`** — Kurmak istediğin workflow'ların spec'leri hakkında kendini birden çok
  oturumda grilling'den geçirirsin; dizin stateful workspace.
- **`/claude-handoff`** — Konuşmayı `claude --bg` ile beslenen taze bir arka plan ajanına
  devreder, iş hemen devam eder.
- **`/implement-spec`** — Tüm spec'i tek dalda uygular; ticket'ları liste değil task grafı
  olarak işler, hazır olan cephede paralel implementer alt-ajanlar koşturur, sonucu tek PR
  olarak indirir.
- **`/setup-ts-deep-modules`** — dependency-cruiser'ı TS repo'suna bağlar: her paket derin
  modül, implementasyon alt klasörlerde gizli, sadece entry-point dosyalarından erişilir.
- **`/retro`** — Oturum sonrası retrospektif; ajanın ortamına (steering dosyaları,
  standartlar, otomatik kontroller) iyileştirme önerir. **Şu an sadece tasarım notu,
  işlevsel değil.**
- **`/writing-beats`**, **`/writing-fragments`**, **`/writing-shape`** — Yazı yazma
  skill'leri: sırasıyla makaleyi "beat"lerden oluşan bir yolculuk gibi kurma, senden ham
  "fragment"lar madenciliği, ham materyali paragraf paragraf şekillendirme.

---

## Misc (nadiren kullanılan, plugin'de tanıtılmayan)

- **`/git-guardrails-claude-code`** — Claude Code hook'ları kurarak tehlikeli git komutlarını
  (`push`, `reset --hard`, `clean`, `branch -D` vb.) çalışmadan engeller.
- **`/setup-pre-commit`** — Husky pre-commit hook'ları + lint-staged (Prettier), type check,
  testler.
- **`/migrate-to-shoehorn`** — Test dosyalarında `as` type assertion'larını
  `@total-typescript/shoehorn`'a taşır.
- **`/scaffold-exercises`** — Section/problem/solution/explainer içeren egzersiz dizin
  yapıları oluşturur (kurs materyali için).

---

## Faz sınırları (phase boundaries) – ek not

Bir **faz** oturum içindeki bir iş parçası (grilling, implementation, QA). İki faz
arasındaki **sınırda** beş seçenek var, sırayla değerlendir, ilk "evet" kazanır:

1. **Continue** – Bu oturumda devam edebilir misin? (sonraki faz bunu birincil kaynak olarak
   istiyor ya da yeterli smart zone var) → hiçbir şey kaybetmez, önce bunu ele.
2. **`/clear`** – Bağlam sonraki iş için tamamen gereksiz mi? En ucuz hamle.
3. **`/handoff`** – Yeni harness / yeni dizin / iş arkadaşı / faz ortası çatallama.
4. **Subagent** – Sıkı kapsamlı, AFK çalıştırılabilir görev (ör. otomatik review).
5. **`/compact`** – Varsayılan ama ilk tercih değil; yukarıdakiler elenince buraya düşer.

Continue hariç her hamle birincil kaynağı ikincil (özet) kaynağa çevirir: bilgi kaybı olur.
