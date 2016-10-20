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
--center Seneca
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
--center Seneca

---
--center a microservices toolkit for node.js

---
--center NSQ

---
--center a realtime distributed messaging platform

---
--center Ok... why?


--newpage Microservices
--heading I smell microservices...

---
--center Do you use them?

---
--center You should!

--beginslideleft
---
 * they are cool
---
 * they make you look smart
---
 * they fig bugs for you
---
 * they make your code simpler
--endslideleft


--newpage Costs
--heading Wait... are you kidding me?

---
--center Of course I am :-)

---
--center They actually have a cost
---
--center and they make your code *more* complex

---
--center (definitely not simpler)


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
(it's like with writing tests)


--newpage Tools
--heading Back to Earth

---
--center We can use tools to manage the complexity introduced by microservices

---
--center (also Erlang would do the job)


--newpage Seneca
--heading Seneca

---
--center lets us decompose our code into isolated actions
---
--center each action handles "messages" (or "events") matching a given pattern
---
--center the action is then "invoked" implicitly other actions emitting messages matching that pattern
---
--center there is a concept of "transports" to invoke actions in other (remote) processes


--newpage Service discovery
--heading The next issue...

---
--center ...is service discovery!
---
--center all these processes must be connected somehow
---
--center manual configuration is tedious and error prone
---
--center automatic discovery has its share of issues :-) 


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
--center A small cluster of nsqlookupd serving all consumers

---
--exec eog -f NSQ-Connections.png


--newpage NSQ - Seneca
--heading Does it match Seneca?

---
--center Not really

---
--center NSQ has no built in req-reply

---
--center Routes by topic and not pattern


--newpage NSQ strengths
--heading NSQ provides

---
--center proper broadcast
---
--center (have you tried "prior"?)
---
--center good autodiscovery
---
--center excellent resiliency

---
--center Stateless, decoupled, possibly idempotent services are its perfect match


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
--center What do you mean by "stateful"
---
--center Managing state is a mess
---
--center Sharding is even worse
---
--center Transient state can be doable


--newpage Stateful examples
--heading A couple of use cases

---
--center A cluster of web socket servers

---
--center A cluster of "area" servers (Hyperfair)


--newpage Takeaway
--heading Wrapping up

---
--center Seneca is excellent for organizing your code at the "action" level

---
--center NSQ can help a lot when connecting your services 

--beginslidebottom
---
--center Thanks for listening!
--endslidebottom


--newpage Styles

--ulon
underlined
--uloff

--revon
reverse
--revoff

--boldon
bold
--boldoff
