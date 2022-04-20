const request = require('request-promise');
const cheerio = require('cheerio');
const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const fs = require('fs');

var app = express();
var server = http.createServer(app);

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');

app.get('/', async function (req, res) {
  const bookList = await loadBookList();
  res.render(path.join(__dirname, './book-list.html'), { bookList });
});

app.get('/bookIndexer', async function (req, res) {
  const bookPreview = req.query.book;
  // console.log(bookPreview);
  const link = await getBookIndexPage(bookPreview);
  //console.log(req.query.book.slice(0, req.query.book.indexOf("/")+1) + link);
  res.redirect('/download?book=' + req.query.book.slice(0, req.query.book.lastIndexOf("/") + 1) + link);
});

app.get('/download', function (req, res) {
  var response = getAllChaptersLinks(req.query.book);
  response.then(function (val) {
    getDownloadLinks(val).then(async function (audioLinks) {
      // console.log(audioLinks);
      await downloadLinks(audioLinks);
      let bookList = "";
      audioLinks.forEach((val, i, arr) => {
        bookList += "<li>" + val + "</li>";
      });
      res.render(path.join(__dirname, './download.html'), { bookList });
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
  let bookList = "";
  const books = [];

  await fillBookList("https://esl-bits.net/ESL.English.Learning.Audiobooks/ESL.Classic.Audiobooks.htm", books);
  await fillBookList("https://esl-bits.net/ESL.English.Learning.Audiobooks/ESL.English.Learning.Audiobooks.html", books);

  books.sort();
  books.forEach((val, i, arr) => {
    bookList += val;
  });
  return bookList;
}

async function fillBookList(url, books) {
  const resp = await request(url, (error, response, html) => {
    const $ = cheerio.load(html);
    const output = $("a");
    output.each((i, element) => {
      //https://esl-bits.net/ESL.English.Learning.Audiobooks/A.Christmas.Carol/preview.html
      //https://esl-bits.net/ESL.English.Learning.Audiobooks/
      const href = element.attribs["href"];
      if (href.includes("preview.html")) {
        let prettifiedTitle = element.children[0].data;
        let fallbackTitle = href.replace(/\./g, ' ').slice(0, href.lastIndexOf("/"));
        if (!prettifiedTitle) {
          prettifiedTitle = fallbackTitle;
        }
        // else if (fallbackTitle.includes("/")) {
        //   prettifiedTitle = fallbackTitle + "   " + prettifiedTitle;
        // }

        // if (prettifiedTitle.includes("Book")) {
        //   // console.log(element);
        // }
        const listItem = "<li><a href=\"bookIndexer?book=https://esl-bits.net/ESL.English.Learning.Audiobooks/" + href + "\">" + prettifiedTitle + "</a></li>";
        if (!books.some(book => book.includes(href))) {
          books.push(listItem);
        }
      }
    });
  });
}

async function getBookIndexPage(previewPage) {
  let link;
  const resp = await request(previewPage, (error, response, html) => {
    if (!error && response.statusCode == 200) {
      const $ = cheerio.load(html);
      const output = $("a");
      output.each((i, element) => {
        if (!element.attribs["href"].includes("/")) {
          link = element.attribs["href"];
        }
      });
    }
  });
  return link;
}

async function getAllChaptersLinks(queryInput) {
  const links = [];
  const resp = await request(queryInput, (error, response, html) => {
    if (!error && response.statusCode == 200) {
      // console.log(queryInput);
      const linkStart = queryInput.slice(0, queryInput.lastIndexOf("/") + 1);//.replace("indice.html", "");
      const $ = cheerio.load(html);
      const output = $("a");
      output.each((i, element) => {
        //console.log(element.attribs["href"]);
        const href = element.attribs["href"];
        if (!href.includes("http") && !href.includes("copyright")) {
          links.push(linkStart + href);
        }
      });
      // const parts = $(".parts");
      // const output = parts.find("a");
      // output.each((i, element) => {
      //   //console.log(linkStart + element.attribs["href"]);
      //   links.push(linkStart + element.attribs["href"]);
      // });
    }
  });
  return links;
}

async function getDownloadLinks(chaptersUrl) {
  const downloadLinks = [];
  for (let i = 0; i < chaptersUrl.length; i++) {
    const chapterUrl = chaptersUrl[i].slice(0, chaptersUrl[i].lastIndexOf('/') + 1);
    // console.log(chapterUrl);
    const topUrl = chapterUrl + "top.html";
    const resp = await request(topUrl, (error, response, html) => {
      if (!error && response.statusCode == 200) {
        if (html.includes(".mp3")) {
          let htmlBody = html.slice(html.indexOf("body"))
          let stopAtMp3Point = htmlBody.slice(0, htmlBody.indexOf(".mp3"));
          const nameOfFile = stopAtMp3Point.slice(stopAtMp3Point.lastIndexOf('"') + 1) + ".mp3";
          // console.log(nameOfFile);
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
    });
    if (!success) {
      console.log("couldn't create /audiobooks folder");
      return;
    }
  }

  let audio = audioUrls[0].slice(0, audioUrls[0].lastIndexOf("/"));
  const levels = audio.split('/');
  folder += levels[levels.length - 2];
  // console.log(folder);

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
    // console.log(element);
    const levels = element.split('/');
    const filePath = folder + '/' + levels[levels.length - 2] + '.mp3';
    // console.log(filePath);
    if (!fs.existsSync(filePath)) {
      let file = fs.createWriteStream(filePath);
      const resp = await request(element, (error, response, html) => {
        if (!error && response.statusCode == 200) {
          console.log('creating file' + filePath);
        }
      }).pipe(file);
    }
  }
}