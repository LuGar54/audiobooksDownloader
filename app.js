const request = require('request');
const rp = require('request-promise');
const cheerio = require('cheerio');
const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const fs = require('fs');
const { url } = require('inspector');

var app = express();
var server = http.createServer(app);
var bookList;

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

app.get('/', async function (req, res) {
  bookList = await loadBookList();
  res.render(path.join(__dirname, './book-list.html'), { bookList: bookList.htmlBooks });
});

app.get('/hobbit', async function (req, res) {
  var audioLinks = ['https://esl-bits.net/ESL.English.Learning.Audiobooks/0%20LOTR/01/design.html'];
  await downloadLinks(audioLinks);
  let bookList = "";
  audioLinks.forEach((val, i, arr) => {
    bookList += "<li>" + val + "</li>";
  });
  res.render(path.join(__dirname, './download.html'), { bookList, prettyTitle: req.query.prettyTitle });
});

app.get('/bookIndexer', async function (req, res) {
  const bookPreview = req.query.book;
  const prettyTitle = req.query.prettyTitle;
  const link = await getBookIndexPage(bookPreview);
  res.redirect('/download?book=' + req.query.book.slice(0, req.query.book.lastIndexOf("/") + 1) + link + '&prettyTitle=' + prettyTitle);
});

app.get('/download', function (req, res) {
  var response = getAllChaptersLinks(req.query.book);
  response.then(function (val) {

    console.log(val);
    getDownloadLinks(val).then(async function (audioLinks) {
      await downloadLinks(audioLinks);
      let bookList = "";
      audioLinks.forEach((val, i, arr) => {
        bookList += "<li>" + val + "</li>";
      });
      res.render(path.join(__dirname, './download.html'), { bookList, prettyTitle: req.query.prettyTitle });
      // res.render(path.join(__dirname, './book-list.html'), { bookList });
      // res.send(audioLinks + "downloaded!");
      // const time = await new Promise(r => setTimeout(r, 2000));
      // res.redirect('/');
    }).catch((reason) => {
      console.error(reason);
    });
  });
});

server.listen(3000, function () {
  console.log("Server listening on port: 3000");
});

async function loadBookList() {
  let htmlBooks = "";
  const books = [];

  await fillBookList("https://esl-bits.eu/ESL.English.Learning.Audiobooks/Classics.htm", books);
  await fillBookList("https://esl-bits.eu/ESL.English.Learning.Audiobooks/Novels.html", books);

  books.sort();
  books.forEach((val, i, arr) => {
    htmlBooks += val.listItem;
  });
  return {
    htmlBooks,
    prettyTitles: books.map(a => a.prettifiedTitle),
  };
}

async function fillBookList(url, books) {
  const resp = await rp(url, (error, response, html) => {
    const $ = cheerio.load(html);
    const output = $("a");
    output.each((i, element) => {
      const href = element.attribs.href;
      if (href.includes("preview.html") || href.includes("0.html")) {
        let prettifiedTitle = element.children[0].data;
        let fallbackTitle = href.replace(/\./g, ' ').slice(0, href.lastIndexOf("/"));
        if (!prettifiedTitle) {
          prettifiedTitle = fallbackTitle;
        }
        const listItem = "<li><a href=\"bookIndexer?book=https://esl-bits.eu/ESL.English.Learning.Audiobooks/" + href + "&prettyTitle=" + prettifiedTitle + "\">" + prettifiedTitle + "</a></li>";
        if (!books.some(book => book.listItem.includes(href)) || !books.some(book => book.prettifiedTitle == prettifiedTitle)) {
          books.push({ listItem, prettifiedTitle });
        }
      }
    });
  });
}

async function getBookIndexPage(previewPage) {
  let link;
  const resp = await rp(previewPage, (error, response, html) => {
    if (!error && response.statusCode == 200) {
      const $ = cheerio.load(html);
      const output = $("a");
      output.each((i, element) => {
        if (!element.attribs.href.includes("/")) {
          link = element.attribs.href;
        }
      });
    }
  });
  return link;
}

async function getAllChaptersLinks(queryInput) {
  const links = [];
  var newQuery = '';
  const resp = await rp(String(queryInput), (error, response, html) => {
    if (!error && response.statusCode == 200) {
      
      if (response.body.includes('URL=')) {
        startPos = response.body.indexOf('URL=')+4;
        newQuery = response.body.substring(startPos, response.body.indexOf('" /',startPos));
      }

      const linkStart = queryInput.slice(0, queryInput.lastIndexOf("/") + 1);
      const $ = cheerio.load(html);
      const output = $("a");
      output.each((i, element) => {
        const href = element.attribs.href;
        if (!href.includes("http") && !href.includes("copyright") && !href.includes(".jpg")) {
          links.push(linkStart + href);
        }
      });
    }
  });

  if (newQuery != '') {
    return await getAllChaptersLinks(newQuery);
  }

  return links;
}

async function getDownloadLinks(chaptersUrl) {
  const downloadLinks = [];
  for (let i = 0; i < chaptersUrl.length; i++) {
    const chapterUrl = chaptersUrl[i].slice(0, chaptersUrl[i].lastIndexOf('/') + 1);
    const topUrl = chapterUrl + "top.html";
    const resp = await rp(topUrl, (error, response, html) => {
      if (!error && response.statusCode == 200) {
        if (html.includes(".mp3")) {
          let htmlBody = html.slice(html.indexOf("body"));
          let stopAtMp3Point = htmlBody.slice(0, htmlBody.indexOf(".mp3"));
          const nameOfFile = stopAtMp3Point.slice(stopAtMp3Point.lastIndexOf('"') + 1) + ".mp3";
          downloadLinks.push(chapterUrl + nameOfFile);
        }
      }
    });
  }

  return downloadLinks;
}

async function downloadLinks(audioUrls) {
  let folder = __dirname + "/audiobooks/";
  if (!fs.existsSync(folder)) {
    let success = true;
    await fs.mkdir(folder, function (err) {
      if (err) {
        console.log("couldn't create /audiobooks folder");
        success = false;
      }
      return true;
    });
    if (!success) {
      console.log("couldn't create /audiobooks folder");
      return;
    }
  }

  let audio = audioUrls[0].slice(0, audioUrls[0].lastIndexOf("/"));
  const levels = audio.split('/');
  folder += levels[levels.length - 2];

  if (fs.existsSync(folder)) {
    await safelyCreateFile(folder, audioUrls);
  }
  else {
    await fs.mkdir(folder, async function (err) {
      if (err) {
        console.log('failed to create directory', err);
      } else {
        await safelyCreateFile(folder, audioUrls);
      }
    });
  }
}

async function safelyCreateFile(folder, audioUrls) {
  for (let i = 0; i < audioUrls.length; i++) {
    const element = audioUrls[i];
    const levels = element.split('/');
    const filePath = folder + '/' + levels[levels.length - 2] + '.mp3';
    if (!fs.existsSync(filePath)) {
      let file = fs.createWriteStream(filePath);
      const resp = await rp(element, (error, response, html) => {
        if (!error && response.statusCode == 200) {
          console.log('creating file' + filePath);
        }
      }).pipe(file);
    }
  }
}