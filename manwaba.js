/** @type {import('./_venera_.js')} */
class ManWaBa extends ComicSource {
  // name of the source
  name = "漫蛙吧";

  // unique id of the source
  key = "manwaba";

  version = "1.0.5";

  minAppVersion = "1.4.0";

  // update url
  url = "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/manwaba.js";

  // 2026-10: mwuu.cc 已 301 跳转到 manwaxu.cc，直连新域名
  api = "https://manwaxu.cc/api";

  // 图片 AES-CBC 密钥（官网阅读器 base.js: BaseUtil.AES_KEY）
  aesKey = "0B6666A0-BB59-1381-B746-a0E4C9AC";

  init() {
    /**
     * Sends an HTTP request.
     */
    this.fetchJson = async (url, { method = "GET", params, headers, payload }) => {
      if (params) {
        let params_str = Object.keys(params)
          .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
          .join("&");
        url += `?${params_str}`;
      }
      let res = await Network.sendRequest(method, url, headers, payload);
      if (res.status !== 200) {
        throw `Invalid status code: ${res.status}, body: ${res.body}`;
      }
      let json = JSON.parse(res.body);
      return json;
    };
  }

  // explore page list
  explore = [
    {
      title: this.name,
      type: "multiPartPage",
      load: async (page) => {
        let params = {
          page: 1,
          pageSize: 6,
          type: "",
          flag: false,
        };
        const url = `${this.api}/home`;
        const data = await this.fetchJson(url, { params }).then((res) => res.data);
        let magnaList = {
          热门: data.comicList,
          最新完整版: data.gufengList,
          最新更新: data.xuanhuanList,
          热门收藏: data.xiaoyuanList,
        };
        function parseComic(comic) {
          return new Comic({
            id: comic.id.toString(),
            title: comic.title,
            subTitle: comic.author,
            cover: comic.pic,
            tags: comic.tags ? comic.tags.split(",") : [],
          });
        }
        let result = [];
        for (let key in magnaList) {
          if (magnaList[key]) {
            result.push({ title: key, comics: magnaList[key].map(parseComic) });
          }
        }
        return result;
      },
    },
  ];

  // categories
  category = {
    title: this.name,
    parts: [
      {
        name: "类型",
        type: "fixed",
        categories: [
          "全部", "热血", "玄幻", "恋爱", "冒险", "古风", "都市", "穿越",
          "奇幻", "其他", "搞笑", "少男", "战斗", "重生", "逆袭", "爆笑",
          "少年", "后宫", "系统", "BL", "韩漫", "完整版", "19r", "台版",
        ],
        itemType: "category",
        categoryParams: [
          "", "热血", "玄幻", "恋爱", "冒险", "古风", "都市", "穿越",
          "奇幻", "其他", "搞笑", "少男", "战斗", "重生", "逆袭", "爆笑",
          "少年", "后宫", "系统", "BL", "韩漫", "完整版", "19r", "台版",
        ],
      },
    ],
    enableRankingPage: false,
  };

  /// category comic loading related
  categoryComics = {
    load: async (category, param, options, page) => {
      let pathMap = {
        "": "/cate",
        "热血": "/cate/hotblooded",
        "玄幻": "/cate/xuanhuan",
        "恋爱": "/cate/romance",
        "冒险": "/cate/adventure",
        "古风": "/cate/historical",
        "都市": "/cate/urban",
        "穿越": "/cate/transmigration",
        "奇幻": "/cate/fantasy",
        "其他": "/cate/other",
        "搞笑": "/cate/comedy",
        "少男": "/cate/shounen",
        "战斗": "/cate/action",
        "重生": "/cate/rebirth",
        "逆袭": "/cate/counterattack",
        "爆笑": "/cate/hilarious",
        "少年": "/cate/youth",
        "后宫": "/cate/harem",
        "系统": "/cate/system",
        "BL": "/cate/bl",
        "韩漫": "/cate/manhwa",
        "完整版": "/cate/fullversion",
        "19r": "/cate/19plus",
        "台版": "/cate/taiwanver",
      };
      let url = this.api + (pathMap[param] || "/cate");
      // options 形如 "2-全部"，取 "-" 前的值
      let optVal = (s) => String(s == null ? "" : s).split("-")[0];
      let statusOpt = optVal(options[0]);
      let payload = JSON.stringify({
        page: {
          page: page,
          pageSize: 10,
        },
        category: "comic",
        sort: parseInt(optVal(options[2]) || "0"),
        comic: {
          status: statusOpt === "2" ? -1 : parseInt(statusOpt),
          day: parseInt(optVal(options[1]) || "0"),
          tag: param,
        },
        video: {
          year: 0,
          typeId: 0,
          typeId1: 0,
          area: "",
          lang: "",
          status: -1,
          day: 0,
        },
        novel: {
          status: -1,
          day: 0,
          sortId: 0,
        },
      });

      let data = await this.fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        payload,
      }).then((res) => res.data.list);

      function parseComic(comic) {
        return new Comic({
          id: comic.url.split("/").pop(),
          title: comic.title,
          subTitle: comic.author,
          cover: comic.pic,
          tags: comic.tags ? comic.tags.split(",") : [],
          description: comic.intro,
          status: comic.status == 0 ? "连载中" : "已完结",
        });
      }
      return {
        comics: data.map(parseComic),
        maxPage: 100,
      };
    },
    optionList: [
      {
        options: ["2-全部", "0-连载中", "1-已完结"],
      },
      {
        options: [
          "0-全部", "1-周一", "2-周二", "3-周三", "4-周四",
          "5-周五", "6-周六", "7-周日",
        ],
      },
      {
        options: ["0-更新", "1-新作", "2-畅销", "3-热门", "4-收藏"],
      },
    ],
  };

  /// search related
  search = {
    load: async (keyword, options, page) => {
      const pageSize = 20;
      let url = `${this.api}/search`;
      let params = {
        keyword,
        type: "mh",
        page,
        pageSize,
      };
      let data = await this.fetchJson(url, { params }).then((res) => res.data);
      let total = data.total;
      let comics = data.list.map((item) => {
        return new Comic({
          id: item.id.toString(),
          title: item.title,
          subTitle: item.author,
          cover: item.cover,
          tags: item.tags ? item.tags.split(",") : [],
          description: item.description,
          status: item.status == 0 ? "连载中" : "已完结",
        });
      });
      let maxPage = Math.ceil(total / pageSize);
      return {
        comics,
        maxPage,
      };
    },
  };

  /// single comic related
  comic = {
    loadInfo: async (id) => {
      let url = `${this.api}/comic/${id}`;
      let data = await this.fetchJson(url, {}).then((res) => res.data);
      let chapterId = data.id;
      let chapterApi = `${this.api}/comic/chapter`;
      let params = {
        comicId: chapterId,
        page: 1,
        pageSize: 1,
      };
      let pageRes = await this.fetchJson(chapterApi, { params });
      let total = pageRes.pagination.total;

      let chapterRes = await this.fetchJson(chapterApi, {
        params: {
          ...params,
          pageSize: total,
        },
      });
      let chapterList = chapterRes.data;
      let chapters = new Map();
      chapterList.forEach((item) => {
        chapters.set(item.id.toString(), item.title.toString());
      });

      return new ComicDetails({
        title: data.title.toString(),
        subTitle: data.author.toString(),
        cover: data.cover,
        tags: {
          类型: data.tags ? data.tags.split(",") : [],
          状态: data.status == 0 ? "连载中" : "已完结",
        },
        chapters,
        description: data.intro,
        updateTime: new Date(data.editTime * 1000).toLocaleDateString(),
      });
    },

    loadEp: async (comicId, epId) => {
      // 图片接口无视分页，一次返回全量
      let imgApi = `${this.api}/comic/image/${epId}`;
      let params = {
        page: 1,
        pageSize: 1000,
        imageSource: "https://tu.mhttu.cc",
      };
      let imageRes = await this.fetchJson(imgApi, { params }).then((res) => res.data.images);
      let images = imageRes.map((item) => item.url);
      return {
        images,
      };
    },

    onImageLoad: (url, comicId, epId) => {
      return {
        headers: {
          Referer: "https://manwaxu.cc/",
        },
        // 图片为 AES-CBC 加密（前 16 字节为 IV），明文图直接返回
        onResponse: (data) => {
          const bytes = new Uint8Array(data);
          if (bytes.length < 16) return data;
          const isImage =
            (bytes[0] === 0xff && bytes[1] === 0xd8) || // JPEG
            (bytes[0] === 0x89 && bytes[1] === 0x50) || // PNG
            (bytes[0] === 0x47 && bytes[1] === 0x49) || // GIF
            (bytes[0] === 0x52 && bytes[1] === 0x49); // RIFF/WebP
          if (isImage) return data;
          const iv = data.slice(0, 16);
          const ciphertext = data.slice(16);
          const key = Convert.encodeUtf8("0B6666A0-BB59-1381-B746-a0E4C9AC").slice(0, 32);
          let decrypted = Convert.decryptAesCbc(ciphertext, key, iv);
          const u8 = new Uint8Array(decrypted);
          const pad = u8[u8.length - 1];
          if (pad >= 1 && pad <= 16 && u8.length > pad) {
            let valid = true;
            for (let i = 1; i <= pad; i++) {
              if (u8[u8.length - i] !== pad) {
                valid = false;
                break;
              }
            }
            if (valid) decrypted = decrypted.slice(0, decrypted.byteLength - pad);
          }
          return decrypted;
        },
      };
    },

    // 封面同样加密，走缩略图加载通道
    onThumbnailLoad: (url) => {
      return {
        headers: {
          Referer: "https://manwaxu.cc/",
        },
        onResponse: (data) => {
          const bytes = new Uint8Array(data);
          if (bytes.length < 16) return data;
          const isImage =
            (bytes[0] === 0xff && bytes[1] === 0xd8) ||
            (bytes[0] === 0x89 && bytes[1] === 0x50) ||
            (bytes[0] === 0x47 && bytes[1] === 0x49) ||
            (bytes[0] === 0x52 && bytes[1] === 0x49);
          if (isImage) return data;
          const iv = data.slice(0, 16);
          const ciphertext = data.slice(16);
          const key = Convert.encodeUtf8("0B6666A0-BB59-1381-B746-a0E4C9AC").slice(0, 32);
          let decrypted = Convert.decryptAesCbc(ciphertext, key, iv);
          const u8 = new Uint8Array(decrypted);
          const pad = u8[u8.length - 1];
          if (pad >= 1 && pad <= 16 && u8.length > pad) {
            let valid = true;
            for (let i = 1; i <= pad; i++) {
              if (u8[u8.length - i] !== pad) {
                valid = false;
                break;
              }
            }
            if (valid) decrypted = decrypted.slice(0, decrypted.byteLength - pad);
          }
          return decrypted;
        },
      };
    },
  };
}
