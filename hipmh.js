// ============================================================
// Venera 漫画源：嬉皮漫画 (hipmh.com / m.hipmh.com)
// key: hipmh | version: 1.0.1
//
// 数据来源（2026-10-04 实测）：
//   列表/详情/搜索: https://hipapi1.s3file.top/v1/*
//   章节图片:       https://hipapi1.s3file.top/v2/chapter?hid=...
//   图片直链:       https://hip-tx-1.s3imgs.top (line1)
//                   https://hip-cf-1.s3imgs.top (line2)
//   封面直链:       https://cover.s3imgs.top
//
// 已验证：探索页(更新/热门/新作)、分类(地区/题材/状态)、搜索、
//         详情(含全部章节分页拉取)、章节图片解密加载。
// 未验证：登录/收藏（站点以游客模式即可阅读，未实现账号相关）。
// ============================================================

const HipmhApiBase = "https://hipapi1.s3file.top/v1";
const HipmhChapterApi = "https://hipapi1.s3file.top/v2/chapter";
const HipmhCoverBase = "https://cover.s3imgs.top";
const HipmhImgBaseL1 = "https://hip-tx-1.s3imgs.top";
const HipmhImgBaseL2 = "https://hip-cf-1.s3imgs.top";

// ---------- base64url 编解码（基于 Venera Convert API） ----------

function hipmhB64UrlDecodeToString(b64url) {
    let s = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (s.length % 4)) % 4;
    for (let i = 0; i < pad; i++) s += "=";
    return Convert.decodeUtf8(Convert.decodeBase64(s));
}

function hipmhB64UrlEncode(str) {
    const b64 = Convert.encodeBase64(Convert.encodeUtf8(str));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- 章节图片解密 ----------
// 还原自 reader.hipmh.top/assets/runtime/chapter-decoder.js 的混淆实现
// payload 结构: "qM9" + body + "Z7"
// body = key(d) + "Vx" + tail(e) + "pL0" + enc(c)，其中
//   n = body.length - 5, c = floor(n/3), d = floor((n-c)/2), e = (n-c)-d
// 之后 enc+key+tail 拼接，按 7 字符分块（偶数块保持、奇数块反转），
// 再经 64 字符替换表映射回 base64url，解码得 JSON 图片路径数组。
function hipmhDecodeImages(payload) {
    const PREFIX = "qM9", SUFFIX = "Z7", MAGIC = "Vx", MARKER = "pL0";
    const ALPHA = "_-9876543210abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    if (typeof payload !== "string" || !payload.startsWith(PREFIX) || !payload.endsWith(SUFFIX)) {
        throw new Error("invalid image data");
    }
    const body = payload.slice(PREFIX.length, -SUFFIX.length);
    const n = (body.length - MAGIC.length) - MARKER.length;
    if (n <= 0) throw new Error("invalid image data");
    const c = Math.floor(n / 3);
    const d = Math.floor((n - c) / 2);
    const e = (n - c) - d;
    const key = body.slice(0, d);
    if (body.slice(d, d + MAGIC.length) !== MAGIC) throw new Error("invalid image data");
    const tail = body.slice(d + MAGIC.length, d + MAGIC.length + e);
    const mo = d + MAGIC.length + e;
    if (body.slice(mo, mo + MARKER.length) !== MARKER) throw new Error("invalid image data");
    const enc = body.slice(mo + MARKER.length);
    if (enc.length !== c) throw new Error("invalid image data");
    const combined = enc + key + tail;
    let unshuffled = "";
    for (let i = 0, idx = 0; i < combined.length; i += 7, idx++) {
        const chunk = combined.slice(i, i + 7);
        unshuffled += (idx % 2 === 0) ? chunk : chunk.split("").reverse().join("");
    }
    let b64 = "";
    for (let i = 0; i < unshuffled.length; i++) {
        const at = ALPHA.indexOf(unshuffled[i]);
        if (at < 0) throw new Error("invalid image data");
        b64 += STD[at];
    }
    return JSON.parse(hipmhB64UrlDecodeToString(b64));
}

// ---------- hid 转换 ----------
// 章节列表返回的是前端 hid: base64url("m:{mangaId}-c:{chapterId}") + "-" + base64url("{mangaId}:{no}")
// 图片接口需要 api hid:    base64url("c:{chapterId}") + "-" + base64url("{mangaId}:{no}")
function hipmhToApiHid(frontHid) {
    const sep = frontHid.lastIndexOf("-");
    if (sep < 0) throw new Error("invalid chapter id");
    const head = hipmhB64UrlDecodeToString(frontHid.slice(0, sep)); // "m:14637-c:58207"
    const m = head.match(/-c:(.+)$/);
    if (!m) throw new Error("invalid chapter id");
    return hipmhB64UrlEncode("c:" + m[1]) + "-" + frontHid.slice(sep + 1);
}

// 注意：Venera 的 QuickJS 引擎没有 URLSearchParams，查询串一律手动拼接
function hipmhQuery(params) {
    const parts = [];
    for (const k in params) {
        const v = params[k];
        if (v === "" || v == null) continue;
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
    }
    return parts.join("&");
}

// ---------- 陷阱图过滤 ----------
// 图片接口会在每话的图片列表里随机塞一条重复记录，其中一张的签名无效，
// 请求会返回 67 字节的 1x1 占位 PNG，在阅读器里被拉伸成黑色块。
// 重复记录的文件名只有签名段不同，用 Range 探测文件头（RIFF=WebP 真图，
// 89 50 4E 47=PNG 陷阱）挑出有效的一张。
function hipmhImageKey(url) {
    const name = url.split("/").pop().split("?")[0];
    const dot = name.lastIndexOf(".");
    const noExt = dot > 0 ? name.slice(0, dot) : name;
    const us = noExt.lastIndexOf("_");
    return us > 0 ? noExt.slice(0, us) : url;
}

async function hipmhIsRealImage(url) {
    const res = await Network.fetchBytes("GET", url, {
        "Range": "bytes=0-16",
        "Referer": "https://m.hipmh.com/",
    }, null);
    const bytes = new Uint8Array(res.body);
    if (bytes.length >= 4) {
        // PNG 文件头 -> 陷阱占位图
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return false;
        // RIFF(WebP) / JPEG 文件头 -> 真图
        if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
        if (bytes[0] === 0xFF && bytes[1] === 0xD8) return true;
    }
    // 兜底：陷阱图只有 67 字节，真图都在几百 KB 以上
    return bytes.length > 1000;
}

async function hipmhFilterTrapImages(urls) {
    const groups = {};
    const order = [];
    for (let i = 0; i < urls.length; i++) {
        const k = hipmhImageKey(urls[i]);
        if (!groups[k]) { groups[k] = []; order.push(k); }
        groups[k].push(urls[i]);
    }
    const out = [];
    for (let i = 0; i < order.length; i++) {
        const g = groups[order[i]];
        if (g.length === 1) { out.push(g[0]); continue; }
        let picked = null;
        for (let j = 0; j < g.length; j++) {
            try {
                if (await hipmhIsRealImage(g[j])) { picked = g[j]; break; }
            } catch (e) { /* 探测失败就试下一张 */ }
        }
        out.push(picked || g[0]);
    }
    return out;
}

// ---------- 通用请求 ----------

async function hipmhGetJson(url) {
    const res = await Network.get(url, {});
    if (res.status !== 200) throw new Error("HTTP " + res.status);
    const json = JSON.parse(res.body);
    if (json.code !== 200 || !json.data) throw new Error("API error: " + (json.message || json.code));
    return json.data;
}

// 列表接口返回的 mid 可能是完整 id，章节/详情接口只要首段
function hipmhShortMid(id) {
    return id.split("-")[0];
}

function hipmhCover(path) {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    return HipmhCoverBase + (path.startsWith("/") ? path : "/" + path);
}

function hipmhToComic(item) {
    const id = item.mid || item.id;
    return new Comic({
        id: id,
        title: item.title || "",
        subtitle: (item.author_names || []).join(" / "),
        cover: hipmhCover(item.vertical_image_url || item.cover_image_url),
        tags: item.genres || [],
        description: item.description || "",
    });
}

async function hipmhLoadMangas(params, page) {
    params.page = page;
    params.per_page = 20;
    const data = await hipmhGetJson(HipmhApiBase + "/mangas?" + hipmhQuery(params));
    const items = data.items || [];
    return {
        comics: items.map(hipmhToComic),
        maxPage: data.total_pages > 0 ? data.total_pages : 1,
    };
}

// ============================================================

class HipmhComicSource extends ComicSource {
    name = "嬉皮漫画";
    key = "hipmh";
    version = "1.0.1";
    minAppVersion = "1.0.0";
    url = "";

    // ---------- 探索页 ----------
    explore = [
        {
            title: "最新更新",
            type: "multiPageComicList",
            load: async (page) => await hipmhLoadMangas({ sort: "updated" }, page),
        },
        {
            title: "热门漫画",
            type: "multiPageComicList",
            load: async (page) => await hipmhLoadMangas({ sort: "popular" }, page),
        },
        {
            title: "最新上架",
            type: "multiPageComicList",
            load: async (page) => await hipmhLoadMangas({ sort: "latest" }, page),
        },
    ];

    // ---------- 分类页 ----------
    category = {
        title: "分类",
        parts: [
            {
                name: "地区",
                type: "fixed",
                categories: ["全部", "国漫", "韩漫"],
                itemType: "category",
                categoryParams: ["", "category:2", "category:1"],
            },
            {
                name: "题材",
                type: "fixed",
                categories: ["全部", "剧情", "玄幻", "穿越", "大女主", "复仇", "逆袭", "冒险", "武侠", "动作", "宫斗", "重生", "异能", "系统"],
                itemType: "category",
                categoryParams: ["", "genre:3", "genre:27", "genre:20", "genre:30", "genre:31", "genre:32", "genre:38", "genre:39", "genre:40", "genre:44", "genre:46", "genre:51", "genre:67"],
            },
            {
                name: "状态",
                type: "fixed",
                categories: ["全部", "连载中", "已完结"],
                itemType: "category",
                categoryParams: ["", "status:ongoing", "status:completed"],
            },
        ],
    };

    categoryComics = {
        load: async (category, param, options, page) => {
            const params = { sort: "updated" };
            if (param) {
                const i = param.indexOf(":");
                if (i > 0) params[param.slice(0, i)] = param.slice(i + 1);
            }
            return await hipmhLoadMangas(params, page);
        },
    };

    // ---------- 搜索 ----------
    search = {
        load: async (keyword, options, page) => {
            const data = await hipmhGetJson(
                HipmhApiBase + "/search?" + hipmhQuery({ q: keyword, page: page, page_size: 20 })
            );
            const items = data.data || [];
            return {
                comics: items.map((it) => new Comic({
                    id: it.id,
                    title: it.title || "",
                    subtitle: (it.authors || []).map((a) => a.name).join(" / "),
                    cover: hipmhCover(it.vertical_image_url),
                    tags: (it.genres || []).map((g) => g.name),
                    description: it.description || "",
                })),
                maxPage: data.total_pages > 0 ? data.total_pages : 1,
            };
        },
    };

    // ---------- 漫画详情 / 章节 / 图片 ----------
    comic = {
        loadInfo: async (id) => {
            const mid = hipmhShortMid(id);
            const info = await hipmhGetJson(HipmhApiBase + "/manga?mid=" + encodeURIComponent(mid));

            // 拉取全部章节：接口单页上限 50 条，先取第 1 页拿到总页数，其余页并行拉取
            const chaptersUrl = (p) =>
                HipmhApiBase + "/manga/chapters?mid=" + encodeURIComponent(mid) +
                "&page=" + p + "&per_page=50&order=asc";
            const firstPage = await hipmhGetJson(chaptersUrl(1));
            const totalPages = Math.min(firstPage.total_pages || 1, 200);
            const chapterPages = [firstPage];
            if (totalPages > 1) {
                const tasks = [];
                for (let p = 2; p <= totalPages; p++) tasks.push(hipmhGetJson(chaptersUrl(p)));
                const rest = await Promise.all(tasks);
                for (let i = 0; i < rest.length; i++) chapterPages.push(rest[i]);
            }
            const chapters = {};
            for (let i = 0; i < chapterPages.length; i++) {
                const items = chapterPages[i].items || [];
                for (let j = 0; j < items.length; j++) {
                    const ch = items[j];
                    chapters[ch.hid] = ch.title || ("第" + ch.chapter_number + "话");
                }
            }

            const tags = {};
            const authors = (info.authors || []).map((a) => a.name).filter((x) => x);
            if (authors.length > 0) tags["作者"] = authors;
            const genres = (info.genres || []).map((g) => g.name).filter((x) => x);
            if (genres.length > 0) tags["题材"] = genres;
            tags["状态"] = [info.status === "completed" ? "已完结" : "连载中"];

            return new ComicDetails({
                title: info.title || "",
                cover: hipmhCover(info.vertical_image_url || info.cover_image_url),
                description: info.description || "",
                tags: tags,
                chapters: chapters,
                updateTime: info.updated_at || "",
                url: "https://m.hipmh.com/works/" + id,
            });
        },

        loadEp: async (comicId, epId) => {
            const apiHid = hipmhToApiHid(epId);
            const data = await hipmhGetJson(HipmhChapterApi + "?hid=" + encodeURIComponent(apiHid));
            if (typeof data.images !== "string") throw new Error("no images");
            const paths = hipmhDecodeImages(data.images);
            const base = data.line === 2 ? HipmhImgBaseL2 : HipmhImgBaseL1;
            const urls = paths.map((p) => base + p);
            // 过滤接口掺入的 1x1 陷阱图（否则章节里会出现黑色块）
            const images = await hipmhFilterTrapImages(urls);
            return { images: images };
        },

        onImageLoad: (url, comicId, epId) => {
            return { headers: { "Referer": "https://reader.hipmh.top/" } };
        },

        link: {
            domains: ["m.hipmh.com", "www.hipmh.com", "hipmh.com"],
            linkToId: (url) => {
                const m = url.match(/hipmh\.com\/works\/([a-zA-Z0-9\-_]+)/);
                return m ? m[1] : null;
            },
        },

        idMatch: "hipmh\\.com\\/works\\/([a-zA-Z0-9\\-_]+)",
    };

    translation = {
        'zh_CN': {
            '最新更新': '最新更新',
            '热门漫画': '热门漫画',
            '最新上架': '最新上架',
            '分类': '分类',
            '地区': '地区',
            '题材': '题材',
            '状态': '状态',
        },
        'zh_TW': {
            '最新更新': '最新更新',
            '热门漫画': '熱門漫畫',
            '最新上架': '最新上架',
            '分类': '分類',
            '地区': '地區',
            '题材': '題材',
            '状态': '狀態',
        },
        'en': {
            '最新更新': 'Latest Updates',
            '热门漫画': 'Popular',
            '最新上架': 'New Releases',
            '分类': 'Categories',
            '地区': 'Region',
            '题材': 'Genre',
            '状态': 'Status',
        },
    };
}
