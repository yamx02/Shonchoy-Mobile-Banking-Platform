const router = require('express').Router()
const bcrypt = require('bcryptjs')

const Client = require('../model/client')

// personal models
const Personal = require('../model/personal/personal')
const PersonalVerification = require('../model/personal/personal_verification')

// agent models
const Agent = require('../model/agent/agent')
const AgentVerification = require('../model/agent/agent_verification')

// merchant models

const Merchant = require('../model/merchant/merchant')
const MerchantVerification = require('../model/merchant/merchant_verification')

// middlewares

const personalAuth = require('../middleware/personal_auth')
const agentAuth = require('../middleware/agent_auth')
const merchantAuth = require('../middleware/merchant_auth')

// sendmoney

const Transaction = require('../model/adminstration/transaction')
const Sendmoney = require('../model/adminstration/send_money')
const Payment = require('../model/adminstration/payments')
const CashIn = require('../model/adminstration/cash_in')
const CashOut = require('../model/adminstration/cash_out')

const nexmo = require('../config/nexmo')
var multer = require('multer')
const { collection } = require('../model/client')
var storage = multer.memoryStorage()
var upload = multer({ dest: 'uploads/', storage: storage })

// personal
router.post('/personal/mobile', async(req, res) => {
    const personal = await Personal.findOne({ mobileNo: req.body.mobileNo })
    if (!personal) {
        res.status(200).send({ message: 'This number is not linked to any account' })
    } else {
        res.status(400).send({ message: 'This number is linked to any account' })
    }
})

// otp verification - nexmo api

router.post('/personal/mobile/sendCode', async(req, res) => {
    console.log(req.body.mobileNo)

    await nexmo.verify.request({
        number: req.body.mobileNo,
        brand: 'Shonchoy',
        code_length: '4'
    }, (err, result) => {
        if (err) {
            res.status(502).send(err)
        } else {
            res.status(200).send(result)
        }
    });
})



router.post('/personal/mobile/verifyCode', async(req, res) => {
    console.log(req.body);
    await nexmo.verify.check({
        request_id: req.body.request_id,
        code: req.body.code,
    }, (err, result) => {
        if (err) {
            res.status(502).send(err)
        } else {
            res.status(200).send(result)
        }
    });
})

router.post('/personal/mobile/cancel', async(req, res) => {
    await nexmo.verify.control({
        request_id: req.body.request_id,
        cmd: 'cancel'
    }, (err, result) => {
        if (err) {
            res.status(502).send(err)
        } else {
            res.status(200).send(result)
        }
    });
})

var cpUpload = upload.fields([{ name: 'name', maxCount: 1 },
    { name: 'primaryGuardian', maxCount: 1 },
    { name: 'motherName', maxCount: 1 },
    { name: 'IDType', maxCount: 1 },
    { name: 'IDNumber', maxCount: 1 },
    { name: 'dob', maxCount: 1 },
    { name: 'address', maxCount: 1 },
    { name: 'city', maxCount: 1 },
    { name: 'subdistrict', maxCount: 1 },
    { name: 'district', maxCount: 1 },
    { name: 'postOffice', maxCount: 1 },
    { name: 'postCode', maxCount: 1 },
    { name: 'mobileNo', maxCount: 1 },
    { name: 'pinCode', maxCount: 1 },
    { name: 'IDFront', maxCount: 1 },
    { name: 'IDBack', maxCount: 1 },
    { name: 'currentPhoto', maxCount: 1 }
])

router.post('/personal/register', cpUpload, async(req, res) => {
    try {
        var client = await Client.findOne({ IDNumber: req.body.IDNumber })
        if (client) {} else {
            client = new Client(req.body)
            await client.save()
        }
        console.log(client);
        const personal = new Personal({ client: client._id, mobileNo: req.body.mobileNo, pinCode: req.body.pinCode })
        await personal.save()
        const personalVerification = new PersonalVerification({
            personal: personal._id,
            IDFront: req.files.IDFront[0].buffer,
            IDBack: req.files.IDBack[0].buffer,
            currentPhoto: req.files.currentPhoto[0].buffer,
        })
        await personalVerification.save()
        res.status(201).send()
    } catch (e) {
        console.log(e);
        res.status(502).send({ message: e.message })
    }
})



router.post('/personal/login', async(req, res) => {
    try {
        const personal = await Personal.authenticate(req.body.mobileNo, req.body.pinCode)
        if (!personal.verified) {
            res.status(400).send({ message: "Account Verification Still in Progress" })
        } else {
            const token = await personal.generateAuthToken()
            const client = await Client.findById(personal.client);
            res.status(200).send({ _id: personal._id.toString(), client: client, mobileNo: personal.mobileNo, balance: parseFloat(personal.balance), token: token })
        }
    } catch (e) {
        res.status(502).send(e.message)
    }
})

router.post('/personal/logout', personalAuth, (req, res) => {
    const personal = req.personal
    const tokens = personal.tokens.filter((tokens) => tokens.token != req.token)
    personal.tokens = tokens
    personal.save().then((result) => {
        res.status(200).send(result)
    }).catch((e) => {
        res.status(400).send(e.message)
    })
})

router.post('/personal/logoutAll', personalAuth, (req, res) => {
    const personal = req.personal
    personal.tokens = []
    personal.save().then((result) => {
        res.status(200).send(result)
    }).catch((e) => {
        res.status(400).send(e.message)
    })
})

router.post('/personal/check', personalAuth, (req, res) => {
    Personal.checkMobileNo(req.body.mobileNo).then((result) => {
        res.send(result)
    }).catch((e) => {
        res.send(e.message)
    })
})

router.get('/personal/me', personalAuth, (req, res) => {
    res.status(200).send(req.personal)
})


router.post('/personal/sendMoney', personalAuth, async(req, res) => {
    console.log(req.body)
    const pinCode = req.body.pinCode
    const amount = req.body.amount
    const transactionType = req.body.transactionType

    const isMatch = await bcrypt.compare(pinCode, req.personal.pinCode)
    if (isMatch) {
        const senderPersonal = req.personal
        const receiverPersonal = await Personal.findOne({ mobileNo: req.body.receiver })

        if (senderPersonal.balance > amount) {
            const transaction = new Transaction({ transactionType, amount })
            await transaction.save()

            senderPersonal.balance = senderPersonal.balance - transaction.amount
            receiverPersonal.balance = receiverPersonal.balance + transaction.amount
            await senderPersonal.save()
            await receiverPersonal.save()

            const sendMoney = new Sendmoney({ transaction: transaction._id, sender: senderPersonal._id, receiver: receiverPersonal._id })
            await sendMoney.save()
            sendMoney.transaction = transaction
            sendMoney.sender = senderPersonal.mobileNo
            sendMoney.receiver = receiverPersonal.mobileNo

            var object = new Object()
            object._id = sendMoney._id
            object.transactionId = transaction._id
            object.transactionType = transaction.transactionType
            object.amount = transaction.amount
            object.sender = senderPersonal.mobileNo
            object.receiver = receiverPersonal.mobileNo
            object.createdAt = sendMoney.createdAt
            console.log(object)
            return res.status(200).send(object)
        } else {
            return res.status(400).send({ message: "Insufficient Balance" })
        }

    } else {
        return res.status(400).send({ message: "Incorrect Pincode" })
    }
})

router.get('/personal/balance', personalAuth, async(req, res) => {
    return res.status(200).send({ balance: req.personal.balance });
})

router.get('/agent/balance', agentAuth, async(req, res) => {
    return res.status(200).send({ balance: parseFloat(req.agent.balance) });
})

router.post('/personal/payment', personalAuth, async(req, res) => {
    const pinCode = req.body.pinCode
    const amount = req.body.amount
    const transactionType = req.body.transactionType

    const isMatch = await bcrypt.compare(pinCode, req.personal.pinCode)
    if (isMatch) {
        const senderPersonal = req.personal
        const merchant = await Merchant.findOne({ mobileNo: req.body.receiver })

        if (senderPersonal.balance > amount) {
            const transaction = new Transaction({ transactionType, amount })
            await transaction.save()

            senderPersonal.balance = senderPersonal.balance - transaction.amount
            merchant.balance = merchant.balance + transaction.amount
            await senderPersonal.save()
            await merchant.save()

            const payment = new Payment({ transaction: transaction._id, sender: senderPersonal._id, receiver: merchant._id })
            await payment.save()
            return res.status(200).send(sendMoney)
        } else {
            return res.status(400).send({ message: "Insufficient Balance" })
        }

    } else {
        return res.status(400).send()
    }
})

router.get('/personal/transactions', personalAuth, async(req, res) => {

    try {
        var allSm = await Sendmoney.find({ $or: [{ sender: req.personal._id }, { receiver: req.personal._id }] }).sort('-createdAt')
        const allCashOut = await CashOut.find({ sender: req.personal._id })
        const allCashIns = await CashIn.find({ receiver: req.personal._id })

        allSm = allSm.concat(allCashOut)
        allSm = allSm.concat(allCashIns)

        for (var i = 0; i < allSm.length; i++) {

            var object = new Object()

            const transaction = await Transaction.findById(allSm[i].transaction)
            object._id = transaction._id
            object.type = transaction.transactionType
            object.amount = transaction.amount

            if (object.type == "cashIn") {
                object.receiver = req.personal.mobileNo
                const agent = await Agent.findById(allSm[i].sender)
                object.sender = agent.mobileNo
                object.as = "receiver"
            } else if (object.type == "cashOut") {
                object.sender = req.personal.mobileNo
                const agent = await Agent.findById(allSm[i].receiver)
                object.receiver = agent.mobileNo
                object.as = "sender"
            } else {
                if (allSm[i].sender == req.personal._id) {
                    object.sender = req.personal.mobileNo
                    const personal = await Personal.findById(allSm[i].receiver)
                    object.receiver = personal.mobileNo
                    object.as = "sender"
                } else {
                    object.receiver = req.personal.mobileNo
                    const personal = await Personal.findById(allSm[i].receiver)
                    object.sender = personal.mobileNo
                    object.as = "receiver"
                }
            }

            object.createdAt = allSm[i].createdAt

            allSm[i] = object
        }

        res.status(200).send(allSm)
    } catch (e) {
        res.status(400).send(e.message)
    }

})


// agent registration

router.post('/agent/registerClient', async(req, res) => {
    try {
        const client = new Client(req.body)
        await client.save()
        res.status(201).send({ client_id: client._id })
    } catch (e) {
        res.status(502).send({ message: e.message })
    }
})

// register agent account

router.post('/agent/registerAccount', async(req, res) => {
    try {
        const agent = new Agent(req.body)
        await agent.save()
        res.status(201).send(agent._id)
    } catch (e) {
        res.status(502).send({ message: e.message })
    }
})

var cpUpload = upload.fields([{ name: 'accountID', maxCount: 1 }, { name: 'IDFront', maxCount: 1 }, { name: 'IDBack', maxCount: 1 }, { name: 'currentPhoto', maxCount: 1 }, { name: 'tradeLicencePhoto', maxCount: 1 }])

router.post('/agent/verifyAccount', cpUpload, async(req, res) => {
    try {
        const agentVerification = new AgentVerification({
            agent: req.body.accountID,
            IDFront: req.files.IDFront[0].buffer,
            IDBack: req.files.IDBack[0].buffer,
            currentPhoto: req.files.currentPhoto[0].buffer,
            tradeLicencePhoto: req.files.tradeLicencePhoto[0].buffer
        })
        await agentVerification.save()
        res.status(201).send(agentVerification._id)
    } catch (e) {
        res.status(502).send({ message: e.message })
    }
})

router.post('/agent/login', async(req, res) => {
    try {
        const agent = await Agent.authenticate(req.body.mobileNo, req.body.pinCode)
        if (!agent.verified) {
            res.status(200).send({ message: "Account Verification Still in Progress" })
        } else {
            const token = await agent.generateAuthToken()
                //

            var object = Object();
            object.client = await Client.findById(agent.client)
            object.businessOrganizationName = agent.businessOrganizationName
            object.mobileNo = agent.mobileNo
            object.authToken = token


            res.status(200).send(object)
        }
    } catch (e) {
        res.status(502).send({ message: e.message })
    }
})

router.post('/agent/logout', agentAuth, async(req, res) => {
    try {
        const agent = req.agent;
        const tokens = agent.tokens.filter((tokens) => tokens.token != req.token)
        agent.tokens = tokens
        await agent.save()
        res.status(200).send()
    } catch (e) {
        res.send(e.message)
    }
})

router.post('/agent/logoutAll', agentAuth, async(req, res) => {
    try {
        const agent = req.agent;
        agent.tokens = []
        await agent.save()
        res.status(200).send()
    } catch (e) {
        res.send(e.message)
    }
})

// agent -> personaal cash in

router.post('/agent/cashIn', agentAuth, async(req, res) => {
    try {
        const agent = req.agent;
        const mobileNo = req.body.mobileNo;
        const personal = await Personal.findOne({ mobileNo: mobileNo })

        const isMatch = await bcrypt.compare(req.body.pinCode, agent.pinCode)
        if (isMatch) {
            if (agent.balance > req.body.amount) {
                const transaction = new Transaction({ transactionType: req.body.transactionType, amount: req.body.amount })

                agent.balance = agent.balance - transaction.amount
                personal.balance = personal.balance + transaction.amount

                await transaction.save()
                await agent.save()
                await personal.save()

                const cashIn = new CashIn({ transaction: transaction._id, sender: agent._id, receiver: personal._id })
                await cashIn.save()

                var object = new Object()

                object._id = cashIn._id
                object.transactionId = transaction._id
                object.amount = transaction.amount
                object.receiver = mobileNo
                object.createdAt = cashIn.createdAt

                return res.status(200).send(object)
            } else {
                res.status(402).send('Insufficient Balance')
            }
        } else {
            res.status(401).send('Incorrect Pincode')
        }
    } catch (e) {
        res.status(502).send(e.message)
    }
})

router.get('/agent/cashOut', agentAuth, async(req, res) => {
    try {
        const cashOuts = await CashOut.find({ receiver: req.agent._id })

        for (var i = 0; i < cashOuts.length; i++) {
            var object = Object()
            object._id = cashOuts[i]._id
            const transaction = await Transaction.findById(cashOuts[i].transaction)

            object.transactionId = transaction._id
            object.amount = transaction.amount

            const personal = await Personal.findById(cashOuts[i].sender)
            object.sender = personal.mobileNo

            object.createdAt = cashOuts[i].createdAt

            cashOuts[i] = object
        }
        return res.status(200).send(cashOuts)

    } catch (e) {
        console.log(e.message)
        res.status(400).send(e.message)
    }
})

router.get('/agent/transactions', agentAuth, async(req, res) => {
    try {
        var allCashIns = await CashIn.find({ sender: req.agent._id })
        const allCashOut = await CashOut.find({ receiver: req.agent._id })

        allCashIns = allCashIns.concat(allCashOut)

        for (var i = 0; i < allCashIns.length; i++) {

            var object = new Object()

            const transaction = await Transaction.findById(allCashIns[i].transaction)
            object._id = transaction._id
            object.type = transaction.transactionType
            object.amount = transaction.amount

            if (object.type == "cashIn") {
                object.sender = req.agent.mobileNo
                const personal = await Personal.findById(allCashIns[i].receiver)
                object.receiver = personal.mobileNo
                object.as = "sender"
            } else {
                object.receiver = req.agent.mobileNo
                const personal = await Personal.findById(allCashIns[i].sender)
                object.sender = personal.mobileNo
                object.as = "receiver"
            }

            object.createdAt = allCashIns[i].createdAt

            allCashIns[i] = object
        }

        res.status(200).send(allCashIns)
    } catch (e) {
        res.status(400).send(e.message)
    }
})

// personal -> agent cash out
router.post('/personal/cashOut', personalAuth, async(req, res) => {
    console.log(req.body)
    try {
        const personal = req.personal
        const agent = await Agent.findOne({ mobileNo: req.body.receiver })
        const isMatch = await bcrypt.compare(req.body.pinCode, personal.pinCode)
        if (isMatch) {
            const amount = parseFloat(req.body.amount)
            const charge = parseFloat(req.body.charge)

            if (personal.balance > amount + charge) {
                const transaction = new Transaction({ transactionType: req.body.transactionType, amount: (amount) })
                agent.balance = agent.balance + amount + (.25 * charge)
                personal.balance = personal.balance - amount - charge

                await transaction.save()
                await agent.save()
                await personal.save()

                const cashOut = new CashOut({ transaction: transaction._id, sender: personal._id, receiver: agent._id })
                await cashOut.save()

                var object = Object();
                object._id = cashOut._id;
                object.transactionId = transaction._id
                object.amount = amount;
                object.charge = charge;
                object.transactionType = transaction.transactionType
                object.sender = req.personal.mobileNo
                object.receiver = agent.mobileNo
                object.createdAt = cashOut.createdAt

                console.log(object)

                return res.status(200).send(object)
            } else {
                res.status(402).send('Insufficient Balance')
            }
        } else {
            res.status(401).send('Incorrect Pincode')
        }

    } catch (e) {
        console.log(e)
        res.send(e.message)
    }
})

// merchant registration

router.post('/merchant/registerClient', async(req, res) => {
    try {
        const client = new Client(req.body)
        await client.save()
        res.status(201).send({ client_id: client._id })
    } catch (e) {
        res.status(502).send({ message: e.message })
    }
})

// register merchant account

router.post('/merchant/registerAccount', async(req, res) => {
    try {
        const merchant = new Merchant(req.body)
        await merchant.save()
        res.status(201).send(merchant._id)
    } catch (e) {
        res.status(502).send({ message: e.message })
    }
})

var cpUpload = upload.fields([{ name: 'accountID', maxCount: 1 }, { name: 'IDFront', maxCount: 1 }, { name: 'IDBack', maxCount: 1 }, { name: 'currentPhoto', maxCount: 1 }, { name: 'tradeLicencePhoto', maxCount: 1 }])

router.post('/merchant/verifyAccount', cpUpload, async(req, res) => {
    try {
        const merchantVerification = new MerchantVerification({
            merchant: req.body.accountID,
            IDFront: req.files.IDFront[0].buffer,
            IDBack: req.files.IDBack[0].buffer,
            currentPhoto: req.files.currentPhoto[0].buffer,
            tradeLicencePhoto: req.files.tradeLicencePhoto[0].buffer
        })
        await merchantVerification.save()
        res.status(201).send(merchantVerification._id)
    } catch (e) {
        res.status(502).send({ message: e.message })
    }
})


router.post('/merchant/login', async(req, res) => {
    try {
        const merchant = await Merchant.authenticate(req.body.mobileNo, req.body.pinCode)
        if (!merchant.verified) {
            res.status(200).send({ message: "Account Verification Still in Progress" })
        } else {
            const token = await merchant.generateAuthToken()
            res.status(200).send({ merchant, token })
        }
    } catch (e) {
        res.status(502).send({ message: e.message })
    }
})

router.post('/merchant/logout', merchantAuth, async(req, res) => {
    try {
        const merchant = req.merchant;
        const tokens = merchant.tokens.filter((tokens) => tokens.token != req.token)
        merchant.tokens = tokens
        await merchant.save()
        res.status(200).send()
    } catch (e) {
        res.send(e.message)
    }
})

router.post('/merchant/logoutAll', merchantAuth, async(req, res) => {
    try {
        const merchant = req.merchant;
        merchant.tokens = []
        await merchant.save()
        res.status(200).send()
    } catch (e) {
        res.send(e.message)
    }
})

/*
router.get('/personal/statements', personalAuth, async(req, res) => {
    const sendMoney = await Sendmoney.find({ $or: [{ 'sender': req.personal._id }, { 'receiver': req.personal._id }] })
    const cashIn = await CashIn.find({ $or: [{ 'receiver': req.personal._id }] })
    const cashOut = await CashOut.find({ $or: [{ 'sender': req.personal._id }] })
    res.send({ sendMoney, cashIn, cashOut })
})*/
module.exports = router