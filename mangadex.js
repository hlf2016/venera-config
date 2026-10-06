// MangaDex 漫画源 for Venera
// API 文档: https://api.mangadex.org/docs/
// v1.0.0 - 2026-10-06

const MD_API = "https://api.mangadex.org";
const MD_UA = { "User-Agent": "Venera/1.6.3" };

// 内容分级: 全部放行
const MD_RATINGS = [
  "contentRating[]=safe",
  "contentRating[]=suggestive",
  "contentRating[]=erotica",
  "contentRating[]=pornographic",
].join("&");

// 体裁标签 ID -> 中文名 (用于分类页)
const MD_GENRES = [
  ["391b0423-d847-456f-aff0-8b0cfc03066b", "动作"],
  ["87cc87cd-a395-47af-b27a-93258283bbc6", "冒险"],
  ["4d32cc48-9f00-4cca-9b5a-a839f0764984", "喜剧"],
  ["cdc58593-87dd-415e-bbc0-2ec27bf404cc", "奇幻"],
  ["b9af3a63-f058-46de-a9a0-e0c13906197a", "剧情"],
  ["423e2eae-a7a2-4a8b-ac03-a8351462d71d", "恋爱"],
  ["07251805-a27e-4d59-b488-f0bfbec15168", "惊悚"],
  ["256c8bd9-4904-4360-bf4f-508a76d67183", "科幻"],
  ["33771934-028e-4cb3-8744-691e866a923e", "历史"],
  ["3b60b75c-a2d7-4860-ab56-05f391bb889c", "心理"],
  ["50880a9d-5440-4732-9afb-8f457127e836", "机甲"],
  ["5ca48985-9a9d-4bd8-be29-80dc0303db72", "犯罪"],
  ["69964a64-2f90-4d33-beeb-f3ed2875eb4c", "运动"],
  ["7064a261-a137-4d3a-8848-2d385de3a99c", "超级英雄"],
  ["81c836c9-914a-4eca-981a-560dad663e73", "魔法少女"],
  ["a3c67850-4684-404e-9b7f-c69850ee5da6", "百合"],
  ["5920b825-4181-4a17-beeb-9918b0ff7a30", "耽美"],
  ["acc803a4-c95a-4c22-86fc-eb6b582d82a2", "武侠"],
  ["ace04997-f6bd-436e-b261-779182193d3d", "异世界"],
  ["b1e97889-25b4-4258-b28b-cd7f4d28ea9b", "哲学"],
  ["c8cbe35b-1b2b-4a3f-9c37-db84c4514856", "医疗"],
  ["cdad7e68-1419-41dd-bdce-27753074a640", "恐怖"],
  ["e5301a23-ebd9-49dd-a0cb-2add944c7fe9", "日常"],
  ["ee968100-4191-4968-93d3-f82d72be7e46", "悬疑"],
  ["f8f62932-27da-4fe4-8ee1-6779a8c5edba", "悲剧"],
];

// 通用 GET JSON, 带 UA, 校验 result
async function mdGetJson(url) {
  const res = await Network.get(url, MD_UA);
  if (res.status !== 200) throw new Error("HTTP " + res.status);
  const json = JSON.parse(res.body);
  if (json.result !== "ok") throw new Error("MangaDex API error");
  return json;
}

// 从多语言对象里按偏好选文本: zh -> zh-hk -> en -> 任意
function mdPickText(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return obj["zh"] || obj["zh-hk"] || obj["en"] || obj["ja"] || Object.values(obj)[0] || "";
}

// 从 relationships 里找封面文件名
function mdCoverFile(manga) {
  const rel = (manga.relationships || []).find((r) => r.type === "cover_art");
  return rel && rel.attributes ? rel.attributes.fileName : null;
}

function mdCoverUrl(mangaId, fileName) {
  if (!fileName) return "";
  return `https://uploads.mangadex.org/covers/${mangaId}/${fileName}.256.jpg`;
}

// 从 relationships 里取作者/画师名
function mdCreators(manga) {
  const names = [];
  for (const r of manga.relationships || []) {
    if ((r.type === "author" || r.type === "artist") && r.attributes) {
      const n = mdPickText(r.attributes.name);
      if (n && !names.includes(n)) names.push(n);
    }
  }
  return names;
}

function mdParseComic(manga) {
  const id = manga.id;
  const attrs = manga.attributes || {};
  return new Comic({
    id: id,
    title: mdPickText(attrs.title),
    subtitle: mdCreators(manga).join(" / "),
    cover: mdCoverUrl(id, mdCoverFile(manga)),
    tags: (attrs.tags || []).map((t) => mdPickText(t.attributes.name)).filter(Boolean),
    description: mdPickText(attrs.description),
  });
}

function mdIncludes() {
  return "includes[]=cover_art&includes[]=author&includes[]=artist";
}

// 章节语言参数
function mdLangParams(lang) {
  if (lang === "en") return "translatedLanguage[]=en";
  if (lang === "all") return "";
  // zh: 中文(含繁体)
  return "translatedLanguage[]=zh&translatedLanguage[]=zh-hk&translatedLanguage[]=zh-ro";
}

class MangaDexSource extends ComicSource {
  name = "MangaDex";
  key = "mangadex";
  version = "1.0.0";
  minAppVersion = "1.0.0";
  url = "";

  settings = {
    chapterLang: {
      title: "章节语言",
      type: "select",
      options: [
        { value: "zh", text: "中文" },
        { value: "en", text: "English" },
        { value: "all", text: "全部语言(按语言分组)" },
      ],
      default: "zh",
    },
  };

  // ---------- 探索页 ----------
  explore = [
    {
      title: this.name,
      type: "multiPartPage",
      load: async (page) => {
        const parts = [
          ["最新更新", `${MD_API}/manga?order[latestUploadedChapter]=desc&limit=12&${mdIncludes()}&${MD_RATINGS}`],
          ["热门", `${MD_API}/manga?order[followedCount]=desc&limit=12&${mdIncludes()}&${MD_RATINGS}`],
          ["新作", `${MD_API}/manga?order[createdAt]=desc&limit=12&${mdIncludes()}&${MD_RATINGS}`],
        ];
        const result = [];
        for (const [title, url] of parts) {
          const json = await mdGetJson(url);
          result.push({
            title: title,
            comics: (json.data || []).map(mdParseComic),
          });
        }
        return result;
      },
    },
  ];

  // ---------- 分类 ----------
  category = {
    title: this.name,
    parts: [
      {
        name: "体裁",
        type: "fixed",
        categories: ["全部"].concat(MD_GENRES.map((g) => g[1])),
        itemType: "category",
        categoryParams: [""].concat(MD_GENRES.map((g) => g[0])),
      },
    ],
  };

  categoryComics = {
    load: async (category, param, options, page) => {
      const pageSize = 20;
      const offset = (page - 1) * pageSize;
      let url =
        `${MD_API}/manga?limit=${pageSize}&offset=${offset}` +
        `&${mdIncludes()}&${MD_RATINGS}&order[followedCount]=desc`;
      if (param) url += `&includedTags[]=${param}`;
      const json = await mdGetJson(url);
      const total = json.total || 0;
      return {
        comics: (json.data || []).map(mdParseComic),
        maxPage: total > 0 ? Math.ceil(total / pageSize) : 1,
      };
    },
  };

  // ---------- 搜索 ----------
  search = {
    load: async (keyword, options, page) => {
      const pageSize = 20;
      const offset = (page - 1) * pageSize;
      // 手动拼接查询串 (Venera QuickJS 无 URLSearchParams)
      const q = encodeURIComponent(keyword);
      const url =
        `${MD_API}/manga?title=${q}&limit=${pageSize}&offset=${offset}` +
        `&${mdIncludes()}&${MD_RATINGS}&order[relevance]=desc`;
      const json = await mdGetJson(url);
      const total = json.total || 0;
      return {
        comics: (json.data || []).map(mdParseComic),
        maxPage: total > 0 ? Math.ceil(total / pageSize) : 1,
      };
    },
  };

  // ---------- 详情 / 章节 / 图片 ----------
  comic = {
    loadInfo: async (id) => {
      // 基本信息
      const infoJson = await mdGetJson(`${MD_API}/manga/${id}?${mdIncludes()}`);
      const manga = infoJson.data;
      const comic = mdParseComic(manga);
      const attrs = manga.attributes || {};

      // 章节: 按语言设置拉取, feed 单页上限 500, 分页拉完
      let lang = "zh";
      try {
        lang = this.loadSetting("chapterLang") || "zh";
      } catch (e) {}
      let chapters = await this.comic._loadChapters(id, lang);
      // 中文模式无结果时回退英文
      if (lang === "zh" && Object.keys(chapters).length === 0) {
        chapters = await this.comic._loadChapters(id, "en");
      }

      return {
        title: comic.title,
        cover: comic.cover.replace(".256.jpg", ".512.jpg"),
        description: comic.description,
        tags: {
          作者: mdCreators(manga),
          标签: comic.tags,
          状态: [attrs.status === "completed" ? "已完结" : "连载中"],
          内容分级: [attrs.contentRating || ""],
        },
        chapters: chapters,
      };
    },

    // 拉取并整理章节: 去重(同卷同话同语言留页数最多的版本), 按卷分组
    _loadChapters: async function (id, lang) {
      const langParam = mdLangParams(lang);
      const groups = new Map(); // groupName -> Map(chapterId -> title)
      const seen = new Map(); // dedupKey -> {id, pages}
      let offset = 0;
      const limit = 500;
      for (;;) {
        let url =
          `${MD_API}/manga/${id}/feed?limit=${limit}&offset=${offset}` +
          `&order[volume]=asc&order[chapter]=asc` +
          `&includes[]=scanlation_group&${MD_RATINGS}`;
        if (langParam) url += `&${langParam}`;
        const json = await mdGetJson(url);
        const list = json.data || [];
        for (const ch of list) {
          const a = ch.attributes || {};
          // 跳过外部链接和不可用章节
          if (a.externalUrl || a.isUnavailable) continue;
          const chNum = a.chapter || "";
          const vol = a.volume || "";
          const chLang = (a.translatedLanguage || "und").toLowerCase();
          // 去重: 同卷+同话+同语言只留页数最多的版本
          const dedupKey = `${vol}|${chNum}|${chLang}`;
          const pages = a.pages || 0;
          const prev = seen.get(dedupKey);
          if (prev && prev.pages >= pages) continue;
          if (prev) {
            // 删掉旧版本的条目
            for (const [, m] of groups) m.delete(prev.id);
          }
          seen.set(dedupKey, { id: ch.id, pages: pages });

          // 章节显示名
          let name;
          const t = (a.title || "").trim();
          if (chNum) name = t ? `第${chNum}话 ${t}` : `第${chNum}话`;
          else name = t || "单话";
          // 汉化组后缀
          const grp = (ch.relationships || []).find((r) => r.type === "scanlation_group");
          const grpName = grp && grp.attributes ? mdPickText(grp.attributes.name) : "";

          // 分组名
          let groupName;
          const volLabel = vol ? `第${vol}卷` : "其他";
          if (lang === "all") {
            const langLabel = chLang === "zh" || chLang.startsWith("zh") ? "中文" : chLang.toUpperCase();
            groupName = `${volLabel} - ${langLabel}`;
          } else {
            groupName = volLabel;
          }
          if (!groups.has(groupName)) groups.set(groupName, new Map());
          groups.get(groupName).set(ch.id, grpName ? `${name} [${grpName}]` : name);
        }
        offset += list.length;
        const total = json.total || 0;
        if (list.length === 0 || offset >= total) break;
        if (offset >= 5000) break; // 安全上限
      }
      const out = {};
      for (const [k, m] of groups) {
        if (m.size > 0) out[k] = Object.fromEntries(m);
      }
      return out;
    },

    loadEp: async (comicId, epId) => {
      const json = await mdGetJson(`${MD_API}/at-home/server/${epId}`);
      const base = json.baseUrl;
      const ch = json.chapter || {};
      const hash = ch.hash;
      const files = ch.data || [];
      if (!base || !hash || files.length === 0) throw new Error("无可用图片");
      return {
        images: files.map((f) => `${base}/data/${hash}/${f}`),
      };
    },

    onImageLoad: (url, comicId, epId) => {
      return {
        headers: {
          Referer: "https://mangadex.org/",
          Origin: "https://mangadex.org",
        },
      };
    },

    // 识别 mangadex.org 的漫画链接
    idMatch: "mangadex\\.org\\/title\\/([0-9a-f-]{36})",
    link: {
      domains: ["mangadex.org"],
      linkToId: (url) => {
        const m = url.match(/mangadex\.org\/title\/([0-9a-f-]{36})/i);
        return m ? m[1] : null;
      },
    },
  };
}
