--fgcolor white
--bgcolor default

--author Massimiliano Mantione 
--title NSQ and Seneca

--center Nodejsconf.it 2016

--center Desenzano del Garda
--date Oct 22 2016


--newpage Intro
--heading What am I Talking About?


---
--boldon
--ulon
--center Seneca.js
--uloff
--boldoff


---
--center and


---
--boldon
--ulon
--center NSQ
--uloff
--boldoff


--newpage What are they?
--heading But...


---
--center What are they?


---
--boldon
--ulon
--center Seneca
--uloff
--boldoff

---
--center a microservices toolkit for node.js


---
--boldon
--ulon
--center NSQ
--uloff
--boldoff

---
--center a realtime distributed messaging platform


---
--center Ok... why?


--newpage Microservices
--heading I smell microservices...


---
--center Do you use them?

---
--ulon
--center You should!
--uloff

--beginslideleft

---
 * they are cool

---
 * they make you look smart

---
 * they fig bugs for you

---
 * they go shopping for you

---
 * they make your code simpler
--endslideleft


--newpage Costs
--heading Wait... are you kidding me?


---
--beginoutput
--center Of course I am :-)
--endoutput


---
--center They actually have a cost

---
--ulon
--center and they make your code *more* complex
--uloff


---
--boldon
--center (definitely not simpler)
--boldoff


--newpage More costs
--heading I make a few claims


---
--center a monolith is simpler than a distributed system

---
--center network transparency is a myth

---
--center latency and network failures will bite you


--newpage Benefits
--heading However

---
--center those costs are worth it
---
--center because the benefit you get are bigger

---
* partial deployments
---
* resiliency
---
* no single points of failures
---
* scalability
---
* isolation of components

---
--ulon
--center (it's like with writing tests)
--uloff


--newpage Tools
--heading Back to Earth


---
--beginoutput
--center We can use *tools* to manage
--center the complexity introduced by microservices
--endoutput

---
--ulon
--center (also Erlang would do the job)
--uloff


--newpage Seneca
--heading Seneca

---
--center lets us decompose our code into isolated actions

---
--center each action handles "messages" (or "events") matching a given pattern

---
--center each action is then "invoked" implicitly
--center when other actions emit messages matching that pattern

---
--center there is a concept of "transports" to invoke actions in other (remote) processes


--newpage Seneca Code
--heading Seneca example

---
--beginoutput
// Action definition
seneca.add({role: 'math', cmd: 'sum'}, (msg, done) => {
  done(null, {result: (msg.a + msg.b)})
})
--endoutput

---
--beginoutput
// Action invocation
seneca.act({role: 'math', cmd: 'sum', a: 1, b: 2}, (err, response) => {
  if (err) throw(err)
  console.log('sum response', response.result)
})
--endoutput

--newpage Service discovery
--heading The next issue...

---
--center ...is service discovery!


---
--center all these processes must be connected somehow

---
--boldon
--center manual configuration is tedious and error prone
--boldoff

---
--ulon
--center automatic discovery has its share of issues :-) 
--uloff


--newpage NSQ
--heading NSQ


---
--center Built at Bitly

---
--center Used in several places

---
--center Passes messages around

---
--center Scales a lot

---
--center Requires minimal operational maintenance


--newpage NSQ Concepts
--heading NSQ Concepts


---
--center Producer

---
--center Topic

---
--center Channel

---
--center Consumer

---
--exec eog -f NSQ-Diagram.gif


--newpage NSQ Topology
--heading Recommended topology


---
--center One nsqd per producer

---
--exec eog -f NSQ-Connections.png

---
--center A small cluster of nsqlookupd serving all consumers

---
--center topics and channels do not need configuration
---
--center the discovery system is eventually consistent
---
--center with no persistent state!


--newpage NSQ - Seneca
--heading Does it match Seneca?


---
--center Not fully

---
--center NSQ has no built in req-reply

---
--center Routes by topic and not by pattern


--newpage NSQ strengths
--heading NSQ provides


---
--center proper broadcast
---
--boldon
--center (have you ever tried "prior"?)
--boldoff

---
--center good autodiscovery

---
--center excellent resiliency


---
--beginoutput
--center Stateless, decoupled, possibly idempotent services
--center are its perfect match
--endoutput


--newpage Demo!
--heading Let's see some code


---
--sethugefont slant
--huge   Demo time!

--horline



--newpage State management
--heading I said stateless services


---
--center What about stateful ones?


---
--center What do you mean by "stateful"?

---
--center Managing state is a mess

---
--center Sharding is even worse

---
--boldon
--ulon
--center But transient state can be doable!
--uloff
--boldoff


--newpage Stateful examples
--heading A couple of use cases


---
--center A cluster of web socket servers


---
--center A cluster of "area" servers (Hyperfair)


--newpage Stateful support
--heading How does it work?

---
--center An ephemeral topic to announce servers
--center (each server listens on a unique ephemeral channel)

---
--center Servers self-select a master

---
--center The master broadcasts the active shards
--center (each shard has a unique topic)

---
--center Each client sends messages to the correct topic

---
--center Each server handles its messages and reroutes the others

---
--boldon
--ulon
--center Let's see!
--uloff
--boldoff



--newpage Takeaway
--heading Wrapping up


---
--center Seneca is excellent for organizing your code at the "action" level


---
--center NSQ can help a lot when connecting your services 


---
--center code and slides on github
--center massimiliano-mantione / nsq-seneca

---
--boldon
--ulon
--center Thanks for listening!
--uloff
--boldoff
