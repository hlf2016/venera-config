/** @type {import('./_venera_.js')} */
class RuManHua extends ComicSource {
  name = "如漫画";
  key = "rumanhua";
  version = "2.1.0";
  minAppVersion = "1.4.0";

  url = "";

  // 域名设置：默认 www.rumanhua.org，可自定义
  // 注意：从大陆直连 www.rumanhua.org 可能被干扰，建议走代理
  settings = {
    customDomain: {
      title: "自定义域名",
      type: "input",
      placeholder: "如 www.rumanhua.net，留空则用默认",
      default: "",
    },
  };

  // 当前使用的完整域名（含 https://）
  get baseDomain() {
    let custom = "";
    try { custom = (this.loadSetting("customDomain") || "").trim(); } catch (e) {}
    if (custom) {
      custom = custom.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (custom) return "https://" + custom;
    }
    return "https://www.rumanhua.org";
  }

  // 兼容旧代码的 domain 字段
  get domain() {
    return this.baseDomain;
  }

  // AES 解密密钥（base64 编码存储）
  #aesKeyCache = null;
  async aesKey() {
    if (this.#aesKeyCache) return this.#aesKeyCache;
    const encodedKey = "OVM4JHZKblUyQU5lU1JvRg==";
    this.#aesKeyCache = await Convert.decodeUtf8(await Convert.decodeBase64(encodedKey));
    return this.#aesKeyCache;
  }

  removePkcs7Padding(buffer) {
    const len = buffer.length;
    const pad = buffer[len - 1];
    if (pad > 0 && pad <= 16) {
      return buffer.slice(0, len - pad);
    }
    return buffer;
  }

  // 解密章节图片参数（AES-CBC，前16字节为IV）
  async decryptParams(encryptedParams, key) {
    try {
      const keyBuffer = await Convert.encodeUtf8(key);
      const decoded = await Convert.decodeBase64(encryptedParams);
      const decodedBytes = new Uint8Array(decoded);
      const ivBytes = decodedBytes.slice(0, 16);
      const ciphertextBytes = decodedBytes.slice(16);

      const decryptedBuffer = await Convert.decryptAesCbc(
        ciphertextBytes.buffer,
        keyBuffer,
        ivBytes.buffer,
      );
      let decryptedBytes = new Uint8Array(decryptedBuffer);
      decryptedBytes = this.removePkcs7Padding(decryptedBytes);
      const decryptedText = await Convert.decodeUtf8(decryptedBytes.buffer);
      return JSON.parse(decryptedText);
    } catch (e) {
      console.error("解密失败: " + e.message);
      return null;
    }
  }

  explore = [
    {
      title: "最新更新",
      type: "multiPageComicList",
      load: async (page) => {
        const url = `${this.domain}/category/order/addtime${page > 1 ? `/page/${page}` : ""}`;
        const res = await Network.get(url);
        if (res.status !== 200) {
          throw `HTTP Error ${res.status}`;
        }
        const document = new HtmlDocument(res.body);
        return {
          comics: this.parseComicList(document),
          maxPage: this.parseMaxPage(document),
        };
      },
    },
  ];

  parseComicList(document) {
    const comicElements = document.querySelectorAll(".list > .item");
    const comics = [];
    for (const element of comicElements) {
      const comic = this.parseComic(element);
      if (comic) comics.push(comic);
    }
    return comics;
  }

  parseComic(element) {
    const linkElement = element.querySelector(".info a");
    if (!linkElement) return null;

    const id = linkElement.attributes["href"];
    const title = linkElement.attributes["title"];
    const imgElement = element.querySelector(".img img");
    const cover = imgElement ? imgElement.attributes["src"] : "";

    const latestChapterElement = element.querySelector(".tip");
    const subTitle = latestChapterElement ? latestChapterElement.text : "";

    const descriptionElement = element.querySelector(".info .line .ibcont");
    const description = descriptionElement ? descriptionElement.text : "";

    const tagElements = element.querySelectorAll(".info .line a[href*='/tags/']");
    const tags = tagElements.map((a) => a.text.trim());

    return new Comic({
      id: id,
      title: title,
      subTitle: subTitle,
      cover: cover,
      tags: tags,
      description: description,
    });
  }

  parseMaxPage(document) {
    const pageLinks = document.querySelectorAll(".divpage a.end");
    if (pageLinks.length > 0) {
      const href = pageLinks[0].attributes["href"];
      if (href) {
        const match = href.match(/page\/(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
    }
    const onPage = document.querySelector(".divpage a.on");
    if (onPage) return parseInt(onPage.text, 10);
    return 1;
  }

  // 搜索走移动端 m.rumanhua.org（PC 端搜索接口已失效）
  // 移动端单页约 5 条结果，无有效分页
  search = {
    load: async (keyword, options, page) => {
      if (page > 1) return { comics: [], maxPage: 1 };
      const mDomain = this.baseDomain.replace("://www.", "://m.");
      const url = `${mDomain}/index.php/search?key=${encodeURIComponent(keyword)}`;
      const res = await Network.get(url);
      if (res.status !== 200) {
        throw `HTTP Error ${res.status}`;
      }
      const document = new HtmlDocument(res.body);
      const comics = [];
      const items = document.querySelectorAll("ul.rankList li");
      for (const li of items) {
        const linkEl = li.querySelector("a[href*='/news/']");
        if (!linkEl) continue;
        const id = linkEl.attributes["href"];
        const imgEl = li.querySelector("img");
        let cover = imgEl ? imgEl.attributes["src"] : "";
        // 过滤掉按钮图，只要封面
        if (cover.includes("read_btn") || cover.includes("title_menu")) cover = "";
        const titleEl = li.querySelector("p.title");
        const title = titleEl ? titleEl.text.trim() : "";
        if (!title) continue;
        const subEl = li.querySelector("p.subtitle");
        const subTitle = subEl ? subEl.text.trim() : "";
        const bottomEl = li.querySelector("p.bottom");
        let author = "";
        if (bottomEl) {
          // p.bottom 内文本为作者，排除嵌套 a/img
          author = bottomEl.text.trim();
        }
        comics.push(new Comic({
          id: id,
          title: title,
          subTitle: subTitle,
          cover: cover,
          description: author,
        }));
      }
      return { comics: comics, maxPage: 1 };
    },
  };

  comic = {
    loadInfo: async (id) => {
      const res = await Network.get(this.domain + id);
      if (res.status !== 200) {
        throw `HTTP Error ${res.status}`;
      }
      const document = new HtmlDocument(res.body);

      const title = document
        .querySelector(".comicInfo .title")
        .text.replace(/.*?分/g, "")
        .trim();
      const cover = document.querySelector(".comicInfo .cover .img img")
        .attributes["src"];

      const infoElements = document.querySelectorAll(".comicInfo .info p");
      let author = "";
      let tags = [];
      let status = "unknown";

      infoElements.forEach((p) => {
        const text = p.text;
        if (text.includes("作  者：")) {
          author = text.replace("作  者：", "").trim();
        } else if (text.includes("类  别：")) {
          p.querySelectorAll("a").forEach((a) => tags.push(a.text.trim()));
        } else if (text.includes("状  态：")) {
          const statusText = text.replace("状  态：", "").trim();
          if (statusText === "连载中") status = "ongoing";
          else if (statusText === "已完结") status = "completed";
        }
      });

      const description = document
        .querySelector(".comicInfo .info .content")
        .text.trim();

      const chapterElements = document.querySelectorAll("#chapterlistload .list a");
      const chapters = new Map();
      chapterElements.forEach((el) => {
        chapters.set(el.attributes["href"], el.text.trim());
      });

      return new ComicDetails({
        id: id,
        title: title,
        cover: cover,
        author: author,
        description: description,
        tags: { 类型: tags },
        status: status,
        chapters: chapters,
      });
    },

    loadEp: async (comicId, epId) => {
      const res = await Network.get(this.domain + epId);
      if (res.status !== 200) {
        throw `HTTP Error ${res.status}`;
      }

      const body = res.body;
      const paramsMatch = body.match(/params\s*=\s*'([^']+)';/);

      // 未加密的直接图片列表（降级）
      if (!paramsMatch || paramsMatch.length < 2) {
        const imageElements = new HtmlDocument(body).querySelectorAll(
          "#images img.lazy-read",
        );
        const images = imageElements.map((el) => el.attributes["data-src"]);
        return { images };
      }

      const decrypted = await this.decryptParams(paramsMatch[1], await this.aesKey());
      if (!decrypted || !decrypted.images) {
        throw "图片解密失败";
      }
      return { images: decrypted.images };
    },

    onImageLoad: (url, comicId, epId) => {
      return {
        url,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36",
          Referer: this.domain + "/",
          Accept: "image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
      };
    },

    onThumbnailLoad: (url, comicId, epId) => {
      return {
        url,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36",
          Referer: this.domain + "/",
        },
      };
    },

    idMatch: "/news/\\d+",

    link: {
      domains: ["www.rumanhua.org"],
      linkToId: (url) => {
        const match = url.match(/\/news\/\d+/);
        return match ? match[0] : null;
      },
    },
  };
}
